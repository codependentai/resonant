<script lang="ts">
  import { onMount } from 'svelte';

  interface FileEntry {
    fileId: string;
    filename: string;
    mimeType: string;
    size: number;
    contentType: 'image' | 'audio' | 'file';
    createdAt: string;
    inUse: boolean;
  }

  let files = $state<FileEntry[]>([]);
  let totalSize = $state(0);
  let totalCount = $state(0);
  let orphanCount = $state(0);
  let loading = $state(true);
  let filter = $state<'all' | 'image' | 'audio' | 'file' | 'orphan'>('all');
  let deleteConfirm = $state<string | null>(null);

  const filteredFiles = $derived(() => {
    if (filter === 'orphan') return files.filter(f => !f.inUse);
    if (filter === 'all') return files;
    return files.filter(f => f.contentType === filter);
  });

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function typeBadge(contentType: string): string {
    if (contentType === 'image') return 'IMG';
    if (contentType === 'audio') return 'AUD';
    return 'FILE';
  }

  function typeBadgeClass(contentType: string): string {
    if (contentType === 'image') return 'badge-image';
    if (contentType === 'audio') return 'badge-audio';
    return 'badge-file';
  }

  async function loadFiles() {
    loading = true;
    try {
      const response = await fetch('/api/files/list');
      if (!response.ok) throw new Error('Failed to fetch files');
      const data = await response.json();
      files = data.files;
      totalSize = data.totalSize;
      totalCount = data.totalCount;
      orphanCount = data.orphanCount;
    } catch (err) {
      console.error('Failed to load files:', err);
    } finally {
      loading = false;
    }
  }

  async function deleteFile(fileId: string) {
    try {
      const response = await fetch(`/api/files/${fileId}`, { method: 'DELETE' });
      if (response.ok) {
        files = files.filter(f => f.fileId !== fileId);
        totalCount--;
        const deleted = files.find(f => f.fileId === fileId);
        if (deleted) totalSize -= deleted.size;
        orphanCount = files.filter(f => !f.inUse).length;
      }
    } catch (err) {
      console.error('Failed to delete file:', err);
    }
    deleteConfirm = null;
  }

  onMount(loadFiles);
</script>

<div class="files-page">
  <header class="files-header">
    <a href="/chat" class="back-link">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M19 12H5M12 19l-7-7 7-7"/>
      </svg>
      Chat
    </a>
    <h1 class="header-title">Files</h1>
    <div class="storage-summary">
      <span class="summary-item">{totalCount} files</span>
      <span class="summary-dot"></span>
      <span class="summary-item">{formatSize(totalSize)}</span>
      {#if orphanCount > 0}
        <span class="summary-dot"></span>
        <span class="summary-item orphan-count">{orphanCount} orphan{orphanCount === 1 ? '' : 's'}</span>
      {/if}
    </div>
  </header>

  <nav class="filter-bar">
    {#each [['all', 'All'], ['image', 'Images'], ['audio', 'Audio'], ['file', 'Files'], ['orphan', 'Orphans']] as [value, label]}
      <button
        class="filter-btn"
        class:active={filter === value}
        onclick={() => filter = value as typeof filter}
      >
        {label}
      </button>
    {/each}
  </nav>

  <div class="files-content">
    {#if loading}
      <p class="loading">Loading files...</p>
    {:else if filteredFiles().length === 0}
      <p class="empty">
        {#if filter === 'orphan'}
          No orphaned files. Everything is in use.
        {:else if filter === 'all'}
          No files uploaded yet.
        {:else}
          No {filter} files found.
        {/if}
      </p>
    {:else}
      <div class="file-list">
        {#each filteredFiles() as file (file.fileId)}
          <div class="file-card">
            <span class="type-badge {typeBadgeClass(file.contentType)}">{typeBadge(file.contentType)}</span>
            <div class="file-info">
              <span class="file-name">{file.filename}</span>
              <span class="file-meta">
                {formatSize(file.size)} &middot; {formatDate(file.createdAt)}
                {#if !file.inUse}
                  <span class="orphan-tag">orphan</span>
                {/if}
              </span>
            </div>
            <div class="file-actions">
              <a
                href="/api/files/{file.fileId}"
                target="_blank"
                rel="noopener"
                class="view-btn"
              >
                View
              </a>
              {#if deleteConfirm === file.fileId}
                <button class="confirm-delete-btn" onclick={() => deleteFile(file.fileId)}>Confirm</button>
                <button class="cancel-btn" onclick={() => deleteConfirm = null}>Cancel</button>
              {:else}
                <button class="delete-btn" onclick={() => deleteConfirm = file.fileId}>Delete</button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .files-page {
    display: flex;
    flex-direction: column;
    height: 100dvh;
    overflow: hidden;
  }

  .files-header {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: calc(env(safe-area-inset-top, 0px) + 1rem) 1rem 1rem;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    flex-wrap: wrap;
  }

  .back-link {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    color: var(--text-muted);
    font-size: 0.875rem;
    text-decoration: none;
    transition: color var(--transition);
  }

  .back-link:hover {
    color: var(--gold-dim);
    text-decoration: none;
  }

  .header-title {
    font-family: var(--font-heading);
    font-size: 1.125rem;
    font-weight: 400;
    color: var(--text-accent);
    letter-spacing: 0.04em;
  }

  .storage-summary {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-left: auto;
    font-size: 0.8125rem;
    color: var(--text-muted);
  }

  .summary-dot {
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background: var(--text-muted);
    opacity: 0.5;
  }

  .orphan-count {
    color: var(--gold-dim);
  }

  .filter-bar {
    display: flex;
    gap: 0;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    overflow-x: auto;
  }

  .filter-btn {
    padding: 0.75rem 1.25rem;
    font-size: 0.8125rem;
    color: var(--text-muted);
    border-bottom: 2px solid transparent;
    transition: all var(--transition);
    white-space: nowrap;
  }

  .filter-btn:hover {
    color: var(--text-secondary);
  }

  .filter-btn.active {
    color: var(--gold);
    border-bottom-color: var(--gold-dim);
  }

  .files-content {
    flex: 1;
    overflow-y: auto;
    padding: 1.5rem;
    padding-bottom: 1.5rem;
  }

  .loading, .empty {
    color: var(--text-muted);
    font-size: 0.875rem;
    font-style: italic;
    text-align: center;
    padding: 2rem;
  }

  .file-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-width: 50rem;
    margin: 0 auto;
  }

  .file-card {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }

  .type-badge {
    font-size: 0.625rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    padding: 0.1875rem 0.375rem;
    border-radius: 0.25rem;
    flex-shrink: 0;
  }

  .badge-image {
    background: var(--bg-active);
    color: var(--accent);
  }

  .badge-audio {
    background: var(--bg-active);
    color: var(--accent);
  }

  .badge-file {
    background: rgba(148, 163, 184, 0.2);
    color: #94a3b8;
  }

  .file-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .file-name {
    font-size: 0.875rem;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-meta {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .orphan-tag {
    display: inline-block;
    font-size: 0.625rem;
    font-weight: 500;
    color: var(--accent);
    background: var(--bg-active);
    padding: 0 0.25rem;
    border-radius: 0.125rem;
    margin-left: 0.25rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .file-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
  }

  .view-btn {
    padding: 0.25rem 0.5rem;
    font-size: 0.75rem;
    color: var(--text-muted);
    text-decoration: none;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    transition: all var(--transition);
  }

  .view-btn:hover {
    color: var(--text-primary);
    border-color: var(--text-muted);
    text-decoration: none;
  }

  .delete-btn {
    padding: 0.25rem 0.5rem;
    font-size: 0.75rem;
    color: var(--text-muted);
    background: transparent;
    border-radius: var(--radius-sm);
    transition: all var(--transition);
  }

  .delete-btn:hover {
    color: #ef4444;
  }

  .confirm-delete-btn {
    padding: 0.25rem 0.5rem;
    font-size: 0.75rem;
    color: white;
    background: #ef4444;
    border-radius: var(--radius-sm);
  }

  .confirm-delete-btn:hover {
    background: #dc2626;
  }

  .cancel-btn {
    padding: 0.25rem 0.5rem;
    font-size: 0.75rem;
    color: var(--text-muted);
    background: transparent;
    border-radius: var(--radius-sm);
  }

  .cancel-btn:hover {
    color: var(--text-secondary);
  }

  @media (max-width: 768px) {
    .files-header {
      padding: calc(env(safe-area-inset-top, 0px) + 0.75rem) 0.75rem 0.75rem;
    }

    .files-content {
      padding: 1rem;
    }

    .file-card {
      flex-wrap: wrap;
    }

    .file-actions {
      width: 100%;
      justify-content: flex-end;
      margin-top: 0.25rem;
    }
  }
</style>
