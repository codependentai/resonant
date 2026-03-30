<script lang="ts">
  let { state, error = null, pendingCount = 0 } = $props<{
    state: string;
    error?: { code: string; message: string } | null;
    pendingCount?: number;
  }>();

  const isVisible = $derived(state !== 'connected' || !!error);
  const statusMessage = $derived(() => {
    if (error) return error.message;
    switch (state) {
      case 'reconnecting':
        return 'Reconnecting...';
      case 'disconnected':
        return 'Disconnected. Retrying...';
      case 'disconnecting':
        return 'Disconnecting...';
      default:
        return '';
    }
  });

  const isError = $derived(!!error);
  const showPending = $derived(pendingCount > 0 && state !== 'connected');
</script>

{#if isVisible}
  <div class="connection-status" class:error={isError} role="alert" aria-live="polite">
    <div class="status-content">
      {#if !isError}
        <div class="spinner"></div>
      {:else}
        <div class="error-icon">!</div>
      {/if}
      <span>{statusMessage()}</span>
      {#if showPending}
        <span class="pending-badge">{pendingCount} queued</span>
      {/if}
    </div>
  </div>
{/if}

<style>
  .connection-status {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    background: var(--bg-tertiary);
    border-bottom: 1px solid var(--border);
    padding: 0.75rem;
    z-index: 50;
    animation: slideDown 0.3s ease-out;
  }

  .connection-status.error {
    background: rgba(239, 68, 68, 0.08);
    border-bottom-color: rgba(239, 68, 68, 0.15);
  }

  @keyframes slideDown {
    from {
      transform: translateY(-100%);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }

  .status-content {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    color: var(--text-secondary);
    font-size: 0.875rem;
  }

  .error .status-content {
    color: var(--status-error, #ef4444);
  }

  .spinner {
    width: 1rem;
    height: 1rem;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .error-icon {
    width: 1.25rem;
    height: 1.25rem;
    background: var(--status-error, #ef4444);
    color: var(--text-primary);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.75rem;
    font-weight: 700;
    flex-shrink: 0;
  }

  .pending-badge {
    background: var(--bg-surface);
    padding: 0.125rem 0.5rem;
    border-radius: 1rem;
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
