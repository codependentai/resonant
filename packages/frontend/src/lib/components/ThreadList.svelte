<script lang="ts">
  import type { ThreadSummary } from '@resonant/shared';

  let {
    threads = [],
    activeThreadId = null,
    onselect,
    oncreate
  } = $props<{
    threads: ThreadSummary[];
    activeThreadId: string | null;
    onselect?: (threadId: string) => void;
    oncreate?: () => void;
  }>();

  let showArchived = $state(false);
  let archivedThreads = $state<ThreadSummary[]>([]);
  let contextMenuThread = $state<string | null>(null);
  let renamingThread = $state<string | null>(null);
  let renameValue = $state('');
  let deleteConfirm = $state<string | null>(null);
  let collapsedMonths = $state<Set<string>>(new Set());
  let monthsInitialized = false;
  let filterQuery = $state('');

  function getMonthKey(dateStr: string | null): string {
    const d = dateStr ? new Date(dateStr) : new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function getMonthLabel(key: string): string {
    const [year, month] = key.split('-');
    const d = new Date(parseInt(year), parseInt(month) - 1, 1);
    return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  }

  const currentMonthKey = getMonthKey(null);

  // Filtered threads (client-side name filter)
  const filteredThreads = $derived(() => {
    if (!filterQuery.trim()) return threads;
    const q = filterQuery.toLowerCase();
    return threads.filter((t: ThreadSummary) => t.name.toLowerCase().includes(q));
  });

  // Group threads: pinned, today, monthly groups for remaining daily, named
  const groupedThreads = $derived(() => {
    const source = filteredThreads();
    const pinnedThreads: ThreadSummary[] = [];
    const todayThreads: ThreadSummary[] = [];
    const namedThreads: ThreadSummary[] = [];
    const monthMap = new Map<string, { label: string; threads: ThreadSummary[] }>();
    const pinnedIds = new Set<string>();

    // If filtering, show flat list (no grouping)
    if (filterQuery.trim()) {
      return {
        pinned: [],
        today: [],
        months: [] as Array<[string, { label: string; threads: ThreadSummary[] }]>,
        named: [],
        filtered: source,
      };
    }

    // First pass: collect pinned threads
    source.forEach((thread: ThreadSummary) => {
      if (thread.pinned_at) {
        pinnedThreads.push(thread);
        pinnedIds.add(thread.id);
      }
    });
    pinnedThreads.sort((a, b) => (a.pinned_at! > b.pinned_at! ? 1 : -1));

    // Second pass: group non-pinned threads
    source.forEach((thread: ThreadSummary) => {
      if (pinnedIds.has(thread.id)) return;
      if (thread.type === 'daily') {
        if (thread.id === activeThreadId || todayThreads.length === 0) {
          todayThreads.push(thread);
        } else {
          const key = getMonthKey(thread.last_activity_at);
          if (!monthMap.has(key)) {
            monthMap.set(key, { label: getMonthLabel(key), threads: [] });
          }
          monthMap.get(key)!.threads.push(thread);
        }
      } else {
        namedThreads.push(thread);
      }
    });

    const months = Array.from(monthMap.entries()).sort((a, b) => b[0].localeCompare(a[0]));

    return {
      pinned: pinnedThreads,
      today: todayThreads,
      months,
      named: namedThreads,
      filtered: null as ThreadSummary[] | null,
    };
  });

  // Initialize collapsed state via effect — no side effects in derived
  $effect(() => {
    const { months } = groupedThreads();
    if (monthsInitialized || months.length === 0) return;
    monthsInitialized = true;

    const collapsed = new Set<string>();
    const activeThread = threads.find((t: ThreadSummary) => t.id === activeThreadId);
    const activeMonthKey = activeThread?.type === 'daily' ? getMonthKey(activeThread.last_activity_at) : null;

    for (const [key] of months) {
      if (key !== currentMonthKey && key !== activeMonthKey) {
        collapsed.add(key);
      }
    }
    collapsedMonths = collapsed;
  });

  function toggleMonth(key: string) {
    const next = new Set(collapsedMonths);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    collapsedMonths = next;
  }

  function handleSelect(threadId: string) {
    onselect?.(threadId);
  }

  function handleCreate() {
    oncreate?.();
  }

  async function handleArchive(threadId: string) {
    try {
      const response = await fetch(`/api/threads/${threadId}/archive`, { method: 'POST' });
      if (response.ok) {
        contextMenuThread = null;
        window.location.reload();
      }
    } catch (err) {
      console.error('Failed to archive thread:', err);
    }
  }

  function startRename(threadId: string, currentName: string) {
    contextMenuThread = null;
    renamingThread = threadId;
    renameValue = currentName;
  }

  async function commitRename(threadId: string) {
    if (!renameValue.trim()) {
      renamingThread = null;
      return;
    }
    try {
      const response = await fetch(`/api/threads/${threadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: renameValue.trim() }),
      });
      if (!response.ok) console.error('Failed to rename thread');
    } catch (err) {
      console.error('Failed to rename thread:', err);
    }
    renamingThread = null;
  }

  function cancelRename() {
    renamingThread = null;
    renameValue = '';
  }

  function handleRenameKeydown(e: KeyboardEvent, threadId: string) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename(threadId);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelRename();
    }
  }

  function startDelete(threadId: string) {
    contextMenuThread = null;
    deleteConfirm = threadId;
  }

  async function confirmDelete(threadId: string) {
    try {
      const response = await fetch(`/api/threads/${threadId}`, { method: 'DELETE' });
      if (!response.ok) console.error('Failed to delete thread');
    } catch (err) {
      console.error('Failed to delete thread:', err);
    }
    deleteConfirm = null;
  }

  function cancelDelete() {
    deleteConfirm = null;
  }

  async function loadArchived() {
    try {
      const response = await fetch('/api/threads/archived');
      if (response.ok) {
        const data = await response.json();
        archivedThreads = data.threads;
      }
    } catch (err) {
      console.error('Failed to load archived threads:', err);
    }
  }

  function toggleArchived() {
    showArchived = !showArchived;
    if (showArchived) loadArchived();
  }

  async function handlePin(threadId: string) {
    try {
      await fetch(`/api/threads/${threadId}/pin`, { method: 'POST' });
      contextMenuThread = null;
    } catch (err) {
      console.error('Failed to pin thread:', err);
    }
  }

  async function handleUnpin(threadId: string) {
    try {
      await fetch(`/api/threads/${threadId}/unpin`, { method: 'POST' });
      contextMenuThread = null;
    } catch (err) {
      console.error('Failed to unpin thread:', err);
    }
  }

  function toggleContextMenu(threadId: string, e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    contextMenuThread = contextMenuThread === threadId ? null : threadId;
  }
</script>

{#snippet threadItem(thread: ThreadSummary)}
  {#if renamingThread === thread.id}
    <div class="rename-input-wrapper">
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="rename-input"
        type="text"
        bind:value={renameValue}
        onkeydown={(e) => handleRenameKeydown(e, thread.id)}
        onblur={() => commitRename(thread.id)}
        autofocus
      />
    </div>
  {:else if deleteConfirm === thread.id}
    <div class="delete-confirm">
      <span class="delete-text">Delete thread and all messages?</span>
      <div class="delete-actions">
        <button class="delete-btn" onclick={() => confirmDelete(thread.id)}>Delete</button>
        <button class="cancel-btn" onclick={cancelDelete}>Cancel</button>
      </div>
    </div>
  {:else}
    <button
      class="thread-item"
      class:active={thread.id === activeThreadId}
      onclick={() => handleSelect(thread.id)}
      oncontextmenu={(e) => toggleContextMenu(thread.id, e)}
    >
      <span class="thread-name">{thread.name}</span>
      {#if thread.unread_count > 0}
        <span class="unread-badge">{thread.unread_count}</span>
      {/if}
    </button>
    {#if contextMenuThread === thread.id}
      <div class="context-menu">
        {#if thread.pinned_at}
          <button onclick={() => handleUnpin(thread.id)}>Unpin</button>
        {:else}
          <button onclick={() => handlePin(thread.id)}>Pin</button>
        {/if}
        {#if thread.type === 'named'}
          <button onclick={() => startRename(thread.id, thread.name)}>Rename</button>
        {/if}
        <button onclick={() => handleArchive(thread.id)}>Archive</button>
        <button class="context-delete" onclick={() => startDelete(thread.id)}>Delete</button>
      </div>
    {/if}
  {/if}
{/snippet}

<aside class="thread-list" aria-label="Thread list">
  <div class="thread-header">
    <div class="thread-header-copy">
      <span class="thread-eyebrow">Workspace</span>
      <h2>Threads</h2>
    </div>
    <button class="new-thread-button" onclick={handleCreate}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 5v14M5 12h14"/>
      </svg>
      New
    </button>
  </div>

  <div class="thread-groups">
    <div class="filter-input-wrapper">
      <input
        class="filter-input"
        type="text"
        placeholder="Filter threads..."
        bind:value={filterQuery}
      />
      {#if filterQuery}
        <button class="filter-clear" onclick={() => filterQuery = ''} aria-label="Clear filter">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      {/if}
    </div>

    {#if groupedThreads().filtered}
      <!-- Flat filtered results -->
      {#each groupedThreads().filtered as thread (thread.id)}
        {@render threadItem(thread)}
      {/each}
      {#if groupedThreads().filtered.length === 0}
        <p class="empty-filter">No matching threads</p>
      {/if}
    {:else}
      {#if groupedThreads().pinned.length > 0}
        <div class="thread-group">
          <h3 class="group-title pinned-title">Pinned</h3>
          {#each groupedThreads().pinned as thread (thread.id)}
            {@render threadItem(thread)}
          {/each}
        </div>
      {/if}

      {#if groupedThreads().today.length > 0}
        <div class="thread-group">
          <h3 class="group-title">Today</h3>
          {#each groupedThreads().today as thread (thread.id)}
            {@render threadItem(thread)}
          {/each}
        </div>
      {/if}

      {#each groupedThreads().months as [key, group]}
        <div class="thread-group">
          <button class="group-title collapsible" onclick={() => toggleMonth(key)}>
            <span class="group-chevron">{collapsedMonths.has(key) ? '▸' : '▾'}</span>
            {group.label}
            <span class="group-count">{group.threads.length}</span>
          </button>
          {#if !collapsedMonths.has(key)}
            {#each group.threads as thread (thread.id)}
              {@render threadItem(thread)}
            {/each}
          {/if}
        </div>
      {/each}

      {#if groupedThreads().named.length > 0}
        <div class="thread-group">
          <h3 class="group-title">Named</h3>
          {#each groupedThreads().named as thread (thread.id)}
            {@render threadItem(thread)}
          {/each}
        </div>
      {/if}
    {/if}
  </div>

  <div class="thread-actions">
    <button class="action-button" onclick={toggleArchived}>
      {showArchived ? 'Hide Archive' : 'Archive'}
    </button>
  </div>

  {#if showArchived}
    <div class="archived-section">
      <h3 class="group-title">Archived</h3>
      {#if archivedThreads.length === 0}
        <p class="empty-archive">No archived threads</p>
      {:else}
        {#each archivedThreads as thread}
          <button
            class="thread-item archived"
            onclick={() => handleSelect(thread.id)}
          >
            <span class="thread-name">{thread.name}</span>
          </button>
        {/each}
      {/if}
    </div>
  {/if}
</aside>

<style>
  .thread-list {
    display: flex;
    flex-direction: column;
    height: 100%;
    background:
      linear-gradient(180deg, var(--bg-hover), transparent 16%),
      var(--bg-primary);
  }

  .thread-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 1rem 1rem 0.75rem 1rem;
    border-bottom: 1px solid var(--border);
  }

  .thread-header-copy {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .thread-eyebrow {
    font-size: 0.6875rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-muted);
  }

  .thread-header h2 {
    font-size: 1rem;
    color: var(--text-primary);
    font-weight: 600;
  }

  .thread-groups {
    flex: 1;
    overflow-y: auto;
    padding: 0.75rem 0 1rem;
  }

  .filter-input-wrapper {
    position: relative;
    padding: 0 0.75rem 0.75rem;
  }

  .filter-input {
    width: 100%;
    min-height: 44px;
    padding: 0.625rem 0.875rem;
    padding-right: 2rem;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 0.875rem;
    color: var(--text-primary);
    font-size: 0.8125rem;
    outline: none;
    transition: border-color var(--transition);
  }

  .filter-input:focus {
    border-color: var(--border-hover);
  }

  .filter-input::placeholder {
    color: var(--text-muted);
  }

  .filter-clear {
    position: absolute;
    right: 1.25rem;
    top: 50%;
    transform: translateY(-50%);
    padding: 0.25rem;
    color: var(--text-muted);
    border-radius: 0.25rem;
    cursor: pointer;
    transition: color 0.15s;
  }

  .filter-clear:hover {
    color: var(--text-primary);
  }

  .empty-filter {
    text-align: center;
    color: var(--text-muted);
    font-size: 0.8125rem;
    padding: 1.5rem 1rem;
  }

  .pinned-title {
    color: var(--accent);
  }

  .thread-group {
    margin-bottom: 1.5rem;
  }

  .group-title {
    font-family: var(--font-body);
    font-size: 0.6875rem;
    font-weight: 600;
    color: var(--text-muted);
    padding: 0 1rem;
    margin-bottom: 0.5rem;
    border: none;
  }

  .group-title.collapsible {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    width: 100%;
    background: transparent;
    cursor: pointer;
    transition: color var(--transition);
  }

  .group-title.collapsible:hover {
    color: var(--text-secondary);
  }

  .group-chevron {
    font-size: 0.5rem;
    width: 0.75rem;
    flex-shrink: 0;
  }

  .group-count {
    margin-left: auto;
    font-size: 0.625rem;
    color: var(--text-muted);
    font-family: var(--font-mono, monospace);
  }

  .thread-item {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.85rem 1rem;
    text-align: left;
    background: transparent;
    color: var(--text-secondary);
    font-size: 0.9rem;
    transition: all var(--transition);
    cursor: pointer;
  }

  .thread-item:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .thread-item.active {
    background: linear-gradient(90deg, rgba(94, 171, 165, 0.12), var(--bg-hover));
    color: var(--text-primary);
  }

  .thread-item.archived {
    opacity: 0.6;
    font-style: italic;
  }

  .thread-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .unread-badge {
    background: var(--accent);
    color: var(--bg-primary);
    font-size: 0.6875rem;
    font-weight: 600;
    padding: 0.0625rem 0.375rem;
    border-radius: 0.75rem;
    margin-left: 0.5rem;
  }

  .context-menu {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 0.875rem;
    padding: 0.35rem;
    margin: 0 0.75rem;
    box-shadow: var(--shadow-md);
  }

  .context-menu button {
    width: 100%;
    min-height: 40px;
    padding: 0.5rem 0.75rem;
    text-align: left;
    background: transparent;
    color: var(--text-secondary);
    font-size: 0.875rem;
    border-radius: 0.625rem;
    cursor: pointer;
  }

  .context-menu button:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .context-delete {
    color: #ef4444 !important;
  }

  .context-delete:hover {
    background: rgba(239, 68, 68, 0.1) !important;
    color: #f87171 !important;
  }

  .rename-input-wrapper {
    padding: 0.375rem 0.75rem;
  }

  .rename-input {
    width: 100%;
    padding: 0.5rem 0.75rem;
    background: var(--bg-surface);
    border: 1px solid var(--border-hover);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-size: 0.9375rem;
    outline: none;
  }

  .rename-input:focus {
    border-color: var(--accent);
  }

  .delete-confirm {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem 1.25rem;
    background: rgba(239, 68, 68, 0.05);
    border-left: 2px solid #ef4444;
  }

  .delete-text {
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }

  .delete-actions {
    display: flex;
    gap: 0.5rem;
  }

  .delete-btn {
    padding: 0.375rem 0.75rem;
    background: #ef4444;
    color: white;
    font-size: 0.8125rem;
    font-weight: 500;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .delete-btn:hover {
    background: #dc2626;
  }

  .cancel-btn {
    padding: 0.375rem 0.75rem;
    background: transparent;
    color: var(--text-muted);
    font-size: 0.8125rem;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .cancel-btn:hover {
    color: var(--text-secondary);
    background: var(--bg-tertiary);
  }

  .thread-actions {
    display: flex;
    border-top: 1px solid var(--border);
    background: var(--bg-surface);
  }

  .action-button {
    flex: 1;
    min-height: 48px;
    padding: 0.875rem;
    background: transparent;
    color: var(--text-muted);
    font-size: 0.8125rem;
    transition: all var(--transition);
    cursor: pointer;
  }

  .action-button:hover {
    background: var(--bg-tertiary);
    color: var(--text-secondary);
  }

  .new-thread-button {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    min-height: 44px;
    padding: 0 0.875rem;
    background: var(--accent);
    color: var(--bg-primary);
    font-size: 0.8125rem;
    font-weight: 500;
    border-radius: 999px;
    transition: all var(--transition);
  }

  .new-thread-button:hover {
    background: var(--accent-hover);
  }

  .archived-section {
    border-top: 1px solid var(--border);
    padding: 0.5rem 0;
    max-height: 200px;
    overflow-y: auto;
  }

  .empty-archive {
    text-align: center;
    color: var(--text-muted);
    font-size: 0.875rem;
    padding: 1rem;
  }

  @media (max-width: 768px) {
    .thread-list {
      position: static;
      width: 100%;
      max-width: none;
      min-width: 0;
      height: 100%;
      box-shadow: none;
      padding-top: 0;
    }

    .thread-header {
      padding-top: calc(env(safe-area-inset-top, 0px) + 0.75rem);
    }

  }
</style>
