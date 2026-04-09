<script lang="ts">
  import { onMount } from 'svelte';
  import { CC_API } from '$lib/utils/cc';

  type ItemType = 'note' | 'task' | 'event';
  type ScratchItem = {
    type: ItemType;
    id: string;
    text: string;
    time?: string;
    created_by?: string;
    created_at: string;
    status?: string;
    project_name?: string;
  };

  let loading = $state(true);
  let items = $state<ScratchItem[]>([]);
  let inputText = $state('');
  let mode = $state<ItemType>('note');
  let inputTime = $state('');
  let editingId = $state<string | null>(null);
  let editText = $state('');

  function buildList(events: any[], tasks: any[], notes: any[]): ScratchItem[] {
    const all: ScratchItem[] = [];

    for (const e of events) {
      all.push({ type: 'event', id: e.id, text: e.title, time: e.all_day ? undefined : e.start_time, created_by: e.created_by, created_at: e.created_at });
    }

    for (const n of notes) {
      all.push({ type: 'note', id: n.id, text: n.text, created_by: n.created_by, created_at: n.created_at });
    }

    for (const t of tasks) {
      all.push({ type: 'task', id: t.id, text: t.text, created_by: t.created_by, created_at: t.created_at, status: t.status, project_name: t.project_name });
    }

    // Events first (by time), then notes/tasks by created_at
    return all.sort((a, b) => {
      if (a.type === 'event' && b.type !== 'event') return -1;
      if (a.type !== 'event' && b.type === 'event') return 1;
      if (a.type === 'event' && b.type === 'event') return (a.time || '').localeCompare(b.time || '');
      return (a.created_at || '').localeCompare(b.created_at || '');
    });
  }

  async function load() {
    try {
      const res = await fetch(`${CC_API}/scratchpad`);
      const data = await res.json();
      if (data.ok) {
        items = buildList(data.events || [], data.tasks || [], data.notes || []);
      }
    } catch { /* silent */ }
    loading = false;
  }

  async function addItem() {
    const text = inputText.trim();
    if (!text) return;

    if (mode === 'note') {
      await fetch(`${CC_API}/scratchpad/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, created_by: 'user' }),
      });
    } else if (mode === 'task') {
      await fetch(`${CC_API}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, created_by: 'user' }),
      });
    } else {
      const today = new Date().toLocaleDateString('en-CA');
      await fetch(`${CC_API}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: text, start_date: today, start_time: inputTime || null, created_by: 'user' }),
      });
      inputTime = '';
    }

    inputText = '';
    await load();
  }

  async function toggleTask(item: ScratchItem) {
    if (item.status === 'completed') {
      await fetch(`${CC_API}/tasks/${item.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' }),
      });
    } else {
      await fetch(`${CC_API}/tasks/${item.id}/complete`, { method: 'PUT' });
    }
    await load();
  }

  async function deleteNote(id: string) {
    await fetch(`${CC_API}/scratchpad/notes/${id}`, { method: 'DELETE' });
    await load();
  }

  async function saveEdit(id: string) {
    if (!editText.trim()) return;
    await fetch(`${CC_API}/scratchpad/notes/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: editText.trim() }),
    });
    editingId = null;
    editText = '';
    await load();
  }

  function startEdit(item: ScratchItem) {
    editingId = item.id;
    editText = item.text;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') addItem();
  }

  function handleEditKeydown(e: KeyboardEvent, id: string) {
    if (e.key === 'Enter') saveEdit(id);
    if (e.key === 'Escape') { editingId = null; editText = ''; }
  }

  function onFocus() { load(); }

  onMount(() => {
    load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  });
</script>

<section class="scratchpad">
  <div class="sp-header">
    <span class="res-section-title" style="margin: 0;">Scratchpad</span>
    <div class="sp-mode-btns">
      <button
        class="sp-mode-btn"
        class:active={mode === 'note'}
        onclick={() => mode = 'note'}
        title="Note"
        aria-label="Note mode"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
      <button
        class="sp-mode-btn"
        class:active={mode === 'task'}
        onclick={() => mode = 'task'}
        title="Task"
        aria-label="Task mode"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
      </button>
      <button
        class="sp-mode-btn"
        class:active={mode === 'event'}
        onclick={() => mode = 'event'}
        title="Event"
        aria-label="Event mode"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      </button>
    </div>
  </div>

  <div class="sp-input-row">
    {#if mode === 'event'}
      <input type="time" class="sp-time-input" bind:value={inputTime} />
    {/if}
    <input
      type="text"
      class="sp-input"
      placeholder={mode === 'note' ? 'Add a note...' : mode === 'task' ? 'Add a task...' : 'Add an event...'}
      bind:value={inputText}
      onkeydown={handleKeydown}
    />
  </div>

  {#if loading}
    <div class="sp-loading">Loading...</div>
  {:else if items.length === 0}
    <p class="sp-empty">Nothing here yet. Type above to add a note or task.</p>
  {:else}
    <div class="sp-timeline">
      {#each items as item (item.id)}
        <div class="sp-item" data-type={item.type}>
          <div class="sp-item-icon">
            {#if item.type === 'event'}
              <span class="sp-time">{item.time || 'all day'}</span>
            {:else if item.type === 'task'}
              <button
                class="sp-checkbox"
                class:checked={item.status === 'completed'}
                onclick={() => toggleTask(item)}
                aria-label={item.status === 'completed' ? 'Mark incomplete' : 'Mark complete'}
              >
                {#if item.status === 'completed'}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
                {/if}
              </button>
            {:else}
              <span class="sp-note-dot"></span>
            {/if}
          </div>

          <div class="sp-item-body" class:completed={item.type === 'task' && item.status === 'completed'}>
            {#if editingId === item.id}
              <input
                type="text"
                class="sp-edit-input"
                bind:value={editText}
                onkeydown={(e) => handleEditKeydown(e, item.id)}
                onblur={() => saveEdit(item.id)}
              />
            {:else}
              {#if item.type === 'note'}
                <button
                  type="button"
                  class="sp-item-text clickable"
                  onclick={() => startEdit(item)}
                >
                  {item.text}
                </button>
              {:else}
                <span class="sp-item-text">{item.text}</span>
              {/if}
              {#if item.project_name}
                <span class="sp-project">{item.project_name}</span>
              {/if}
            {/if}
          </div>

          <div class="sp-item-meta">
            {#if item.created_by}
              <span class="sp-author">{item.created_by.charAt(0)}</span>
            {/if}
            {#if item.type === 'note'}
              <button class="sp-delete" onclick={() => deleteNote(item.id)} aria-label="Delete note">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</section>

<style>
  .scratchpad {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 1rem;
    border: 1px solid var(--border);
    border-radius: 1.25rem;
    background: rgba(255, 255, 255, 0.02);
    box-shadow: var(--shadow-sm);
  }

  .sp-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .sp-input-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .sp-input {
    flex: 1;
    min-height: 40px;
    padding: 0 0.75rem;
    background: var(--bg-hover);
    border: 1px solid var(--border);
    border-radius: 0.625rem;
    color: var(--text-primary);
    font-size: 0.875rem;
    font-family: var(--font-body);
    outline: none;
    transition: border-color var(--transition);
  }

  .sp-input:focus {
    border-color: var(--accent);
  }

  .sp-input::placeholder {
    color: var(--text-muted);
  }

  .sp-time-input {
    width: 5.5rem;
    min-height: 40px;
    padding: 0 0.5rem;
    background: var(--bg-hover);
    border: 1px solid var(--border);
    border-radius: 0.625rem;
    color: var(--text-primary);
    font-size: 0.8125rem;
    font-family: var(--font-body);
    outline: none;
    flex-shrink: 0;
  }

  .sp-time-input:focus {
    border-color: var(--accent);
  }

  .sp-time {
    font-size: 0.75rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .sp-mode-btns {
    display: flex;
    gap: 0.25rem;
    flex-shrink: 0;
  }

  .sp-mode-btn {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 0.5rem;
    border: 1px solid transparent;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: all var(--transition);
  }

  .sp-mode-btn:hover {
    color: var(--text-secondary);
    background: var(--bg-hover);
  }

  .sp-mode-btn.active {
    color: var(--accent);
    border-color: var(--accent);
    background: rgba(94, 171, 165, 0.08);
  }

  .sp-timeline {
    display: flex;
    flex-direction: column;
  }

  .sp-item {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.45rem 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.03);
    min-height: 36px;
  }

  .sp-item:last-child {
    border-bottom: none;
  }

  .sp-item[data-type="event"] .sp-item-icon {
    color: var(--accent);
  }

  .sp-item[data-type="task"] .sp-item-icon {
    color: #4ade80;
  }

  .sp-item[data-type="note"] .sp-item-icon {
    color: #fbbf24;
  }

  .sp-item-icon {
    flex-shrink: 0;
    width: 1.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .sp-checkbox {
    width: 20px;
    height: 20px;
    border-radius: 4px;
    border: 2px solid currentColor;
    background: transparent;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition: all var(--transition);
  }

  .sp-checkbox.checked {
    background: #4ade80;
    border-color: #4ade80;
    color: var(--bg-primary);
  }

  .sp-note-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: currentColor;
    opacity: 0.6;
  }

  .sp-item-body {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .sp-item-body.completed {
    opacity: 0.5;
  }

  .sp-item-body.completed .sp-item-text {
    text-decoration: line-through;
  }

  .sp-item-text {
    font-size: 0.875rem;
    color: var(--text-primary);
    overflow-wrap: anywhere;
    /* Reset button defaults when sp-item-text is a <button> */
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    font-family: inherit;
    text-align: left;
  }

  .sp-item-text.clickable {
    cursor: pointer;
  }

  .sp-item-text.clickable:hover {
    color: var(--accent);
  }

  .sp-project {
    font-size: 0.6875rem;
    color: var(--accent);
    flex-shrink: 0;
  }

  .sp-edit-input {
    flex: 1;
    min-height: 28px;
    padding: 0 0.5rem;
    background: var(--bg-hover);
    border: 1px solid var(--accent);
    border-radius: 0.375rem;
    color: var(--text-primary);
    font-size: 0.875rem;
    font-family: var(--font-body);
    outline: none;
  }

  .sp-item-meta {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex-shrink: 0;
  }

  .sp-author {
    font-size: 0.625rem;
    color: var(--text-muted);
    text-transform: uppercase;
    font-weight: 600;
    opacity: 0.6;
  }

  .sp-delete {
    width: 20px;
    height: 20px;
    border-radius: 4px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    opacity: 0;
    transition: all var(--transition);
  }

  .sp-item:hover .sp-delete {
    opacity: 1;
  }

  .sp-delete:hover {
    color: var(--color-danger);
    background: rgba(176, 112, 104, 0.12);
  }

  .sp-loading {
    text-align: center;
    color: var(--text-muted);
    font-size: 0.8125rem;
    padding: 1rem;
  }

  .sp-empty {
    text-align: center;
    color: var(--text-muted);
    font-size: 0.8125rem;
    padding: 1.5rem 0;
  }

  @media (max-width: 640px) {
    .scratchpad {
      padding: 0.85rem;
      border-radius: 1rem;
    }

    .sp-mode-btns {
      gap: 0.125rem;
    }
  }
</style>
