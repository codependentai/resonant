<script lang="ts">
  import { onMount } from 'svelte';

  interface SessionInfo {
    sessionId: string;
    summary: string;
    lastModified: number;
    fileSize: number;
    customTitle?: string;
    firstPrompt?: string;
    gitBranch?: string;
    cwd?: string;
  }

  let sessions = $state<SessionInfo[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  function formatDate(ts: number): string {
    const date = new Date(ts);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
    return date.toLocaleDateString('en-GB', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }

  onMount(async () => {
    try {
      const res = await fetch('/api/sessions?limit=50', { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      sessions = data.sessions || [];
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load sessions';
    } finally {
      loading = false;
    }
  });
</script>

<div class="panel">
  <h2 class="panel-title">Agent Sessions</h2>

  {#if loading}
    <div class="loading">Loading sessions...</div>
  {:else if error}
    <div class="error-note">{error}</div>
  {:else if sessions.length === 0}
    <div class="empty-note">No sessions found.</div>
  {:else}
    <div class="session-list">
      {#each sessions as session}
        <div class="session-card">
          <div class="session-header">
            <span class="session-title">{session.customTitle || session.summary || 'Untitled session'}</span>
            <span class="session-date">{formatDate(session.lastModified)}</span>
          </div>
          {#if session.firstPrompt}
            <div class="session-prompt">{session.firstPrompt}</div>
          {/if}
          <div class="session-meta">
            <span class="session-size">{formatSize(session.fileSize)}</span>
            <span class="session-id">{session.sessionId.slice(0, 8)}</span>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .panel-title {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .loading, .empty-note {
    color: var(--text-muted);
    font-size: 0.875rem;
    font-style: italic;
  }

  .error-note {
    color: var(--status-error, #ef4444);
    font-size: 0.875rem;
  }

  .session-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .session-card {
    background: var(--bg-tertiary);
    border-radius: var(--radius-sm);
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .session-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .session-title {
    font-size: 0.8rem;
    color: var(--text-primary);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .session-date {
    font-size: 0.7rem;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .session-prompt {
    font-size: 0.7rem;
    color: var(--text-secondary);
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .session-meta {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-size: 0.65rem;
    color: var(--text-muted);
    font-family: var(--font-mono);
  }
</style>
