<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import OrchestratorPanel from '$lib/components/OrchestratorPanel.svelte';
  import SystemStatusPanel from '$lib/components/SystemStatusPanel.svelte';
  import McpActivityPanel from '$lib/components/McpActivityPanel.svelte';
  import SkillsPanel from '$lib/components/SkillsPanel.svelte';
  import NotificationsPanel from '$lib/components/NotificationsPanel.svelte';
  import DiscordPanel from '$lib/components/DiscordPanel.svelte';
  import SessionsPanel from '$lib/components/SessionsPanel.svelte';
  import PreferencesPanel from '$lib/components/PreferencesPanel.svelte';
  import {
    loadSettings,
    getSystemStatus,
    getOrchestratorTasks,
    getTriggers,
    isLoading,
  } from '$lib/stores/settings.svelte';
  import { send, getConnectionState } from '$lib/stores/websocket.svelte';

  let activeTab = $state<'preferences' | 'orchestrator' | 'system' | 'mcp' | 'skills' | 'notifications' | 'discord' | 'sessions'>('preferences');
  let systemStatus = $derived(getSystemStatus());
  let loading = $derived(isLoading());
  let connectionState = $derived(getConnectionState());
  let statusInterval: ReturnType<typeof setInterval> | null = null;

  const sections = [
    { id: 'preferences', label: 'Preferences', desc: 'Theme, companion name, and display' },
    { id: 'orchestrator', label: 'Orchestrator', desc: 'Night routines and failsafes' },
    { id: 'system', label: 'System', desc: 'Runtime health and presence' },
    { id: 'mcp', label: 'MCP Servers', desc: 'Connected tools and services' },
    { id: 'skills', label: 'Skills', desc: 'Installed capability packs' },
    { id: 'notifications', label: 'Notifications', desc: 'Alerts and delivery' },
    { id: 'discord', label: 'Discord', desc: 'Community and routing' },
    { id: 'sessions', label: 'Sessions', desc: 'Active and past sessions' },
  ] as const;

  // Request system status via WebSocket every 5 seconds
  function startStatusPolling() {
    // Request immediately
    if (connectionState === 'connected') {
      send({ type: 'request_status' });
    }

    statusInterval = setInterval(() => {
      if (connectionState === 'connected') {
        send({ type: 'request_status' });
      }
    }, 5000);
  }

  function stopStatusPolling() {
    if (statusInterval) {
      clearInterval(statusInterval);
      statusInterval = null;
    }
  }

  function closeSettings() {
    goto('/chat');
  }

  function handleWindowKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSettings();
    }
  }

  onMount(async () => {
    await loadSettings();
    startStatusPolling();
  });

  onDestroy(() => {
    stopStatusPolling();
  });
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<div class="settings-overlay">
  <button class="settings-backdrop" onclick={closeSettings} aria-label="Close settings"></button>

  <div class="settings-modal" role="dialog" aria-modal="true" aria-label="Settings">
    <aside class="settings-sidebar">
      <div class="settings-sidebar-header">
        <a href="/chat" class="back-link">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
          Back
        </a>
        <div class="settings-kicker">
          <span class="settings-eyebrow">Control center</span>
          <h1>Settings</h1>
          <p>Keep the system tuned without leaving the workspace.</p>
        </div>
      </div>

      <nav class="settings-nav" aria-label="Settings sections">
        {#each sections as section}
          <button
            class="settings-nav-item"
            class:active={activeTab === section.id}
            onclick={() => activeTab = section.id}
          >
            <span class="settings-nav-label">{section.label}</span>
            <span class="settings-nav-desc">{section.desc}</span>
          </button>
        {/each}
      </nav>
    </aside>

    <div class="settings-content">
      <header class="settings-content-header">
        <div class="settings-section-copy">
          <span class="settings-eyebrow">Current section</span>
          <h2>{sections.find(s => s.id === activeTab)?.label}</h2>
          <p>{sections.find(s => s.id === activeTab)?.desc}</p>
        </div>
        <button class="settings-close" onclick={closeSettings}>Close</button>
      </header>

      <div class="settings-summary">
        <div class="summary-pill">
          <span class="summary-label">Connection</span>
          <strong>{connectionState}</strong>
        </div>
        <div class="summary-pill">
          <span class="summary-label">System</span>
          <strong>{systemStatus ? systemStatus.presence : 'loading'}</strong>
        </div>
        <div class="summary-pill">
          <span class="summary-label">Loaded</span>
          <strong>{loading ? 'No' : 'Yes'}</strong>
        </div>
      </div>

      <div class="settings-panel">
        <div class="settings-panel-scroll">
          {#if loading}
            <div class="loading">Loading settings...</div>
          {:else if activeTab === 'preferences'}
            <PreferencesPanel />
          {:else if activeTab === 'orchestrator'}
            <OrchestratorPanel tasks={systemStatus?.orchestratorTasks ?? getOrchestratorTasks()} triggers={getTriggers()} />
          {:else if activeTab === 'system'}
            <SystemStatusPanel status={systemStatus} />
          {:else if activeTab === 'mcp'}
            <McpActivityPanel status={systemStatus} />
          {:else if activeTab === 'skills'}
            <SkillsPanel />
          {:else if activeTab === 'notifications'}
            <NotificationsPanel />
          {:else if activeTab === 'discord'}
            <DiscordPanel />
          {:else if activeTab === 'sessions'}
            <SessionsPanel />
          {/if}
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  .settings-overlay {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.25rem;
    background:
      radial-gradient(circle at top left, rgba(94, 171, 165, 0.14), transparent 24%),
      rgba(0, 0, 0, 0.5);
  }

  .settings-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.42);
    backdrop-filter: blur(10px);
  }

  .settings-modal {
    position: relative;
    z-index: 1;
    display: grid;
    grid-template-columns: minmax(16rem, 18rem) minmax(0, 1fr);
    width: min(1100px, 100%);
    height: min(92dvh, 980px);
    max-height: min(92dvh, 980px);
    min-height: 0;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 1.5rem;
    background: var(--bg-secondary);
    box-shadow: var(--shadow-lg);
  }

  .settings-sidebar {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    min-height: 0;
    padding: 1.15rem;
    border-right: 1px solid var(--border);
    background: linear-gradient(180deg, var(--bg-hover), transparent 24%);
  }

  .settings-sidebar-header {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }

  .settings-kicker h1 {
    font-size: 1.5rem;
    color: var(--text-primary);
    line-height: 1.1;
    margin-top: 0.25rem;
  }

  .settings-kicker p {
    margin-top: 0.35rem;
    color: var(--text-secondary);
    font-size: 0.875rem;
  }

  .settings-nav {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    min-height: 0;
    overflow-y: auto;
    padding-right: 0.15rem;
  }

  .settings-nav-item {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    align-items: flex-start;
    width: 100%;
    min-height: 54px;
    padding: 0.75rem 0.85rem;
    border-radius: 1rem;
    border: 1px solid transparent;
    color: var(--text-secondary);
    background: transparent;
    text-align: left;
    transition: all var(--transition);
    appearance: none;
  }

  .settings-nav-item:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
    border-color: var(--border);
  }

  .settings-nav-item.active {
    color: var(--text-primary);
    background: var(--gold-ember);
    border-color: rgba(94, 171, 165, 0.25);
  }

  .settings-nav-label {
    font-size: 0.875rem;
    font-weight: 600;
  }

  .settings-nav-desc {
    font-size: 0.75rem;
    color: inherit;
    opacity: 0.72;
  }

  .settings-content {
    display: flex;
    flex-direction: column;
    flex: 1;
    gap: 1rem;
    min-width: 0;
    min-height: 0;
    width: 100%;
    max-width: none;
    padding: 1.15rem;
    overflow: hidden;
  }

  .settings-content-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    padding-bottom: 0.85rem;
    border-bottom: 1px solid var(--border);
  }

  .settings-section-copy {
    min-width: 0;
  }

  .settings-content-header h2 {
    font-size: 1.25rem;
    color: var(--text-primary);
    margin-top: 0.2rem;
  }

  .settings-content-header p {
    margin-top: 0.35rem;
    color: var(--text-secondary);
    font-size: 0.875rem;
  }

  .settings-close,
  .back-link {
    min-height: 44px;
  }

  .settings-close {
    padding: 0 0.95rem;
    border-radius: 0.875rem;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text-secondary);
    transition: all var(--transition);
  }

  .settings-close:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
    border-color: var(--border-hover);
  }

  .settings-summary {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.75rem;
  }

  .summary-pill {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.85rem 0.95rem;
    border: 1px solid var(--border);
    border-radius: 1rem;
    background: var(--bg-surface);
  }

  .summary-label {
    font-size: 0.6875rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
  }

  .summary-pill strong {
    font-size: 0.875rem;
    color: var(--text-primary);
    text-transform: capitalize;
  }

  .settings-panel {
    flex: 1;
    min-height: 0;
    border: 1px solid var(--border);
    border-radius: 1.15rem;
    background: var(--bg-surface);
    overflow: hidden;
    display: flex;
  }

  .settings-panel-scroll {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
    padding: 1rem;
  }

  .settings-panel-scroll > :global(.panel),
  .settings-panel-scroll > :global(.skills-panel) {
    min-height: 0;
  }

  .settings-panel-scroll > :global(.panel) > :global(.panel-title) {
    display: none;
  }

  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 15rem;
    color: var(--text-muted);
    font-size: 0.875rem;
  }

  @media (max-width: 900px) {
    .settings-overlay {
      padding: 0;
      align-items: stretch;
    }

    .settings-modal {
      width: 100%;
      height: 100dvh;
      max-height: 100dvh;
      min-height: 100dvh;
      border-radius: 0;
      display: flex;
      flex-direction: column;
    }

    .settings-sidebar {
      border-right: none;
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
      padding: calc(env(safe-area-inset-top, 0px) + 0.5rem) 0.8rem 0.45rem;
      gap: 0.45rem;
      background:
        linear-gradient(180deg, var(--bg-hover), transparent 24%),
        var(--bg-primary);
    }

    .settings-sidebar-header {
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
      gap: 0.65rem;
    }

    .back-link {
      margin-top: 0;
      flex-shrink: 0;
      min-height: 40px;
    }

    .settings-kicker {
      min-width: 0;
      flex: 1;
    }

    .settings-eyebrow {
      display: none;
    }

    .settings-kicker h1 {
      margin-top: 0;
      font-size: 0.95rem;
    }

    .settings-kicker p {
      display: none;
    }

    .settings-nav {
      flex-direction: row;
      flex-shrink: 0;
      align-items: center;
      gap: 0.35rem;
      overflow-x: auto;
      overflow-y: hidden;
      padding-right: 0;
      padding-bottom: 0.05rem;
      scrollbar-width: none;
    }

    .settings-nav-item {
      min-width: 6.5rem;
      flex: 0 0 auto;
      flex-direction: row;
      align-items: center;
      gap: 0.4rem;
      justify-content: center;
      min-height: 38px;
      padding: 0.5rem 0.8rem;
      border-radius: 999px;
      flex-shrink: 0;
      border-color: var(--border);
      background: var(--bg-hover);
      color: var(--text-primary);
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.01);
    }

    .settings-nav-label {
      white-space: nowrap;
      font-size: 0.8rem;
    }

    .settings-nav-desc {
      display: none;
    }

    .settings-nav-item.active {
      background: rgba(94, 171, 165, 0.22);
      border-color: rgba(94, 171, 165, 0.3);
      color: var(--text-primary);
    }

    .settings-content {
      gap: 0.75rem;
      padding: 0.8rem;
      min-height: 0;
    }

    .settings-content-header {
      gap: 0.65rem;
      padding-bottom: 0.7rem;
    }

    .settings-content-header h2 {
      margin-top: 0.05rem;
      font-size: 1.05rem;
    }

    .settings-content-header p {
      margin-top: 0.2rem;
      font-size: 0.8125rem;
    }

    .settings-close {
      display: none;
    }

    .settings-summary {
      display: flex;
      gap: 0.5rem;
      overflow-x: auto;
      overflow-y: hidden;
      scrollbar-width: none;
      padding-bottom: 0.05rem;
    }

    .summary-pill {
      flex: 0 0 auto;
      min-width: 7.25rem;
      padding: 0.7rem 0.8rem;
      border-radius: 0.9rem;
    }

    .summary-label {
      font-size: 0.625rem;
    }

    .summary-pill strong {
      font-size: 0.8125rem;
    }
  }

  @media (max-width: 640px) {
    .settings-sidebar {
      padding: calc(env(safe-area-inset-top, 0px) + 0.45rem) 0.65rem 0.4rem;
    }

    .settings-nav {
      gap: 0.3rem;
    }

    .settings-nav-item {
      min-width: 6rem;
      padding: 0.46rem 0.72rem;
    }

    .settings-content {
      padding: 0.7rem;
    }

    .settings-panel-scroll {
      padding: 0.78rem;
    }

    .settings-content-header {
      flex-direction: column;
    }

    .summary-pill {
      min-width: 6.75rem;
      padding: 0.65rem 0.75rem;
    }
  }
</style>
