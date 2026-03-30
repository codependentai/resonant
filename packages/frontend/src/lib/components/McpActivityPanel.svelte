<script lang="ts">
  import { onMount } from 'svelte';
  import type { SystemStatus, McpServerInfo } from '@resonant/shared';
  import { sendMcpReconnect, sendMcpToggle } from '$lib/stores/websocket.svelte';

  let { status }: { status: SystemStatus | null } = $props();

  interface AuditEntry {
    id: string;
    tool_name: string;
    tool_input: string | null;
    tool_output: string | null;
    created_at: string;
  }

  interface ToolGroup {
    prefix: string;
    count: number;
    tools: Map<string, { count: number; lastUsed: string }>;
    lastUsed: string;
  }

  let entries = $state<AuditEntry[]>([]);
  let groups = $state<ToolGroup[]>([]);
  let auditLoading = $state(true);
  let expandedServer = $state<string | null>(null);
  let expandedGroup = $state<string | null>(null);
  let showAudit = $state(false);

  function statusColor(s: McpServerInfo['status']): string {
    switch (s) {
      case 'connected': return 'var(--status-active)';
      case 'pending': return 'var(--status-waking)';
      case 'disabled': return 'var(--text-muted)';
      case 'failed': return 'var(--status-error, #ef4444)';
      case 'needs-auth': return 'var(--status-warning, #f59e0b)';
      default: return 'var(--text-muted)';
    }
  }

  function statusLabel(s: McpServerInfo['status']): string {
    switch (s) {
      case 'connected': return 'Connected';
      case 'pending': return 'Connecting...';
      case 'disabled': return 'Disabled';
      case 'failed': return 'Failed';
      case 'needs-auth': return 'Auth Required';
      default: return s;
    }
  }

  function getPrefix(toolName: string): string {
    const idx = toolName.indexOf('_');
    return idx > 0 ? toolName.substring(0, idx) : toolName;
  }

  function buildGroups(entries: AuditEntry[]): ToolGroup[] {
    const groupMap = new Map<string, ToolGroup>();

    for (const entry of entries) {
      const prefix = getPrefix(entry.tool_name);

      if (!groupMap.has(prefix)) {
        groupMap.set(prefix, { prefix, count: 0, tools: new Map(), lastUsed: entry.created_at });
      }

      const group = groupMap.get(prefix)!;
      group.count++;

      if (entry.created_at > group.lastUsed) {
        group.lastUsed = entry.created_at;
      }

      const tool = group.tools.get(entry.tool_name);
      if (tool) {
        tool.count++;
        if (entry.created_at > tool.lastUsed) tool.lastUsed = entry.created_at;
      } else {
        group.tools.set(entry.tool_name, { count: 1, lastUsed: entry.created_at });
      }
    }

    return Array.from(groupMap.values()).sort((a, b) => b.count - a.count);
  }

  function formatTime(iso: string): string {
    const date = new Date(iso);
    return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  function formatDate(iso: string): string {
    const date = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
    return date.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
  }

  onMount(async () => {
    try {
      const res = await fetch('/api/audit?limit=200', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        entries = data.entries || [];
        groups = buildGroups(entries);
      }
    } catch (err) {
      console.error('Failed to load audit entries:', err);
    } finally {
      auditLoading = false;
    }
  });
</script>

<div class="panel">
  <h2 class="panel-title">MCP Servers</h2>

  {#if !status?.mcpServers || status.mcpServers.length === 0}
    <div class="empty-note">No MCP server data yet. Status refreshes on each agent query.</div>
  {:else}
    <div class="server-list">
      {#each status.mcpServers as server}
        <div class="server-card">
          <button class="server-header" onclick={() => expandedServer = expandedServer === server.name ? null : server.name}>
            <span class="status-dot" style="background: {statusColor(server.status)}"></span>
            <span class="server-name">{server.name}</span>
            <span class="server-status" style="color: {statusColor(server.status)}">{statusLabel(server.status)}</span>
            <span class="tool-count">{server.toolCount} tools</span>
            {#if server.tools && server.tools.length > 0}
              <span class="expand-icon" class:expanded={expandedServer === server.name}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M3 5l3 3 3-3"/>
                </svg>
              </span>
            {/if}
          </button>

          {#if server.error}
            <div class="server-error">{server.error}</div>
          {/if}

          <div class="server-actions">
            {#if server.status === 'failed'}
              <button class="action-btn reconnect-btn" onclick={() => sendMcpReconnect(server.name)}>
                Reconnect
              </button>
            {/if}
            <button
              class="action-btn toggle-btn"
              onclick={() => sendMcpToggle(server.name, server.status === 'disabled')}
            >
              {server.status === 'disabled' ? 'Enable' : 'Disable'}
            </button>
          </div>

          {#if expandedServer === server.name && server.tools && server.tools.length > 0}
            <div class="tool-list">
              {#each server.tools as tool}
                <div class="tool-row">
                  <span class="tool-name">{tool.name}</span>
                  {#if tool.description}
                    <span class="tool-desc">{tool.description}</span>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  <!-- Audit log section -->
  <div class="audit-section">
    <button class="audit-toggle" onclick={() => showAudit = !showAudit}>
      <span>Recent Activity</span>
      <span class="expand-icon" class:expanded={showAudit}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 5l3 3 3-3"/>
        </svg>
      </span>
    </button>

    {#if showAudit}
      {#if auditLoading}
        <div class="loading">Loading audit log...</div>
      {:else if groups.length === 0}
        <div class="empty-note">No tool usage recorded yet.</div>
      {:else}
        <div class="group-list">
          {#each groups as group}
            <div class="group">
              <button class="group-header" onclick={() => expandedGroup = expandedGroup === group.prefix ? null : group.prefix}>
                <span class="group-prefix">{group.prefix}_*</span>
                <span class="group-count">{group.count} calls</span>
                <span class="group-last">Last: {formatDate(group.lastUsed)}</span>
                <span class="expand-icon" class:expanded={expandedGroup === group.prefix}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 5l3 3 3-3"/>
                  </svg>
                </span>
              </button>

              {#if expandedGroup === group.prefix}
                <div class="tool-details">
                  {#each [...group.tools.entries()].sort((a, b) => b[1].count - a[1].count) as [toolName, info]}
                    <div class="audit-tool-row">
                      <span class="tool-name">{toolName}</span>
                      <span class="tool-count">{info.count}x</span>
                      <span class="tool-last">{formatTime(info.lastUsed)}</span>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    {/if}
  </div>
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

  .empty-note {
    color: var(--text-muted);
    font-size: 0.8rem;
    font-style: italic;
  }

  .loading {
    color: var(--text-muted);
    font-size: 0.875rem;
    font-style: italic;
  }

  /* Server list */
  .server-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .server-card {
    background: var(--bg-tertiary);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }

  .server-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.625rem 0.75rem;
    width: 100%;
    text-align: left;
    cursor: pointer;
    transition: background 0.15s;
  }

  .server-header:hover {
    background: var(--bg-surface);
  }

  .status-dot {
    display: inline-block;
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .server-name {
    font-size: 0.8rem;
    font-family: var(--font-mono);
    color: var(--text-primary);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .server-status {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .tool-count {
    font-size: 0.7rem;
    color: var(--text-muted);
    font-family: var(--font-mono);
  }

  .server-error {
    padding: 0.375rem 0.75rem 0.5rem;
    font-size: 0.7rem;
    color: var(--status-error, #ef4444);
    font-family: var(--font-mono);
  }

  .server-actions {
    display: flex;
    gap: 0.375rem;
    padding: 0.25rem 0.75rem 0.5rem;
  }

  .action-btn {
    font-size: 0.65rem;
    padding: 0.25rem 0.5rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    color: var(--text-secondary);
    background: transparent;
    cursor: pointer;
    transition: all 0.15s;
    letter-spacing: 0.02em;
  }

  .action-btn:hover {
    background: var(--bg-surface);
    color: var(--text-primary);
  }

  .reconnect-btn {
    border-color: var(--status-error, #ef4444);
    color: var(--status-error, #ef4444);
  }

  .reconnect-btn:hover {
    background: rgba(239, 68, 68, 0.1);
  }

  .tool-list {
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--border);
    max-height: 200px;
    overflow-y: auto;
  }

  .tool-row {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    padding: 0.375rem 0.75rem 0.375rem 1.5rem;
    font-size: 0.7rem;
  }

  .tool-row:not(:last-child) {
    border-bottom: 1px solid var(--border);
  }

  .tool-name {
    font-family: var(--font-mono);
    color: var(--text-secondary);
  }

  .tool-desc {
    font-size: 0.65rem;
    color: var(--text-muted);
    line-height: 1.3;
  }

  /* Audit section */
  .audit-section {
    border-top: 1px solid var(--border);
    padding-top: 0.75rem;
  }

  .audit-toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 0.375rem 0;
    font-size: 0.875rem;
    color: var(--text-secondary);
    cursor: pointer;
    text-align: left;
  }

  .audit-toggle:hover {
    color: var(--text-primary);
  }

  .expand-icon {
    color: var(--text-muted);
    transition: transform 0.2s;
    display: flex;
  }

  .expand-icon.expanded {
    transform: rotate(180deg);
  }

  /* Audit groups */
  .group-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-top: 0.5rem;
  }

  .group {
    background: var(--bg-tertiary);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }

  .group-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.625rem 0.75rem;
    width: 100%;
    text-align: left;
    cursor: pointer;
    transition: background 0.15s;
  }

  .group-header:hover {
    background: var(--bg-surface);
  }

  .group-prefix {
    font-size: 0.8rem;
    font-family: var(--font-mono);
    color: var(--accent);
    flex: 1;
  }

  .group-count {
    font-size: 0.7rem;
    color: var(--text-secondary);
    font-family: var(--font-mono);
  }

  .group-last {
    font-size: 0.7rem;
    color: var(--text-muted);
  }

  .tool-details {
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--border);
  }

  .audit-tool-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.375rem 0.75rem 0.375rem 1.5rem;
    font-size: 0.7rem;
  }

  .audit-tool-row:not(:last-child) {
    border-bottom: 1px solid var(--border);
  }

  .audit-tool-row .tool-name {
    flex: 1;
  }

  .tool-count {
    color: var(--text-muted);
    font-family: var(--font-mono);
  }

  .tool-last {
    color: var(--text-muted);
    font-family: var(--font-mono);
  }

  @media (max-width: 768px) {
    .server-name {
      max-width: 120px;
    }
  }
</style>
