<script lang="ts">
  import type { SystemStatus } from '@resonant/shared';

  let { status }: { status: SystemStatus | null } = $props();

  function formatUptime(seconds: number): string {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h ${mins}m`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  }

  function formatBytes(bytes: number): string {
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  }

  function formatMinutes(minutes: number): string {
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${Math.round(minutes)}m ago`;
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    if (hours < 24) return `${hours}h ${mins}m ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h ago`;
  }

  function presenceColor(presence: string): string {
    switch (presence) {
      case 'active': return 'var(--status-active)';
      case 'waking': return 'var(--status-waking)';
      case 'dormant': return 'var(--status-dormant)';
      default: return 'var(--status-offline)';
    }
  }
</script>

<div class="panel">
  <h2 class="panel-title">System Status</h2>

  {#if !status}
    <div class="loading">Waiting for status data...</div>
  {:else}
    <div class="status-grid">
      <div class="stat-card">
        <span class="stat-label">Uptime</span>
        <span class="stat-value">{formatUptime(status.uptime)}</span>
      </div>

      <div class="stat-card">
        <span class="stat-label">Memory (RSS)</span>
        <span class="stat-value">{formatBytes(status.memoryUsage.rss)}</span>
      </div>

      <div class="stat-card">
        <span class="stat-label">Heap</span>
        <span class="stat-value">{formatBytes(status.memoryUsage.heapUsed)} / {formatBytes(status.memoryUsage.heapTotal)}</span>
      </div>

      <div class="stat-card">
        <span class="stat-label">Connections</span>
        <span class="stat-value">{status.connections}</span>
      </div>

      <div class="stat-card">
        <span class="stat-label">Agent</span>
        <span class="stat-value">
          <span class="presence-dot" style="background: {presenceColor(status.presence)}"></span>
          {status.presence}
          {#if status.agentProcessing}
            <span class="processing-badge">processing</span>
          {/if}
        </span>
      </div>

      <div class="stat-card">
        <span class="stat-label">Mary</span>
        <span class="stat-value">
          {#if status.maryConnected}
            <span class="presence-dot" style="background: var(--status-active)"></span>
            connected
          {:else}
            <span class="presence-dot" style="background: var(--status-dormant)"></span>
            {formatMinutes(status.minutesSinceActivity)}
          {/if}
        </span>
      </div>
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

  .loading {
    color: var(--text-muted);
    font-size: 0.875rem;
    font-style: italic;
  }

  .status-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.75rem;
  }

  .stat-card {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.75rem;
    background: var(--bg-tertiary);
    border-radius: var(--radius-sm);
  }

  .stat-label {
    font-size: 0.75rem;
    color: var(--text-secondary);
  }

  .stat-value {
    font-size: 0.875rem;
    color: var(--text-primary);
    font-family: var(--font-mono);
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }

  .presence-dot {
    display: inline-block;
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .processing-badge {
    font-size: 0.625rem;
    padding: 0.125rem 0.375rem;
    background: var(--accent-muted);
    color: white;
    border-radius: 0.25rem;
    font-family: var(--font-body);
  }

  @media (max-width: 768px) {
    .status-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
