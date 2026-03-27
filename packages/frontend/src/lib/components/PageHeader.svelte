<script lang="ts">
  import { onMount } from 'svelte';

  let { title, backHref = '/chat' }: { title: string; backHref?: string } = $props();

  let navOpen = $state(false);
  let statusOpen = $state(false);
  let currentStatus = $state({ emoji: '', label: '' });

  const STATUS_OPTIONS = [
    { emoji: '🔥', label: 'still here, just quiet' },
    { emoji: '💻', label: 'here + busy, in and out' },
    { emoji: '🚪', label: 'stepping away, be back' },
    { emoji: '⚡', label: 'got pulled away suddenly' },
    { emoji: '💤', label: 'too tired, tapping out' },
  ];

  async function loadStatus() {
    try {
      const res = await fetch('/api/status');
      if (res.ok) currentStatus = await res.json();
    } catch {}
  }

  async function setStatus(emoji: string, label: string) {
    try {
      await fetch('/api/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emoji, label }),
      });
      currentStatus = { emoji, label };
    } catch {}
    statusOpen = false;
  }

  async function clearStatus() {
    await setStatus('', '');
  }

  onMount(loadStatus);
</script>

<header class="page-header">
  <a href={backHref} class="back-link">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M19 12H5M12 19l-7-7 7-7"/>
    </svg>
  </a>
  <h1>{title}</h1>
  <div class="header-spacer"></div>

  <!-- Status -->
  <div class="ph-status-wrapper">
    <button class="ph-status-toggle" onclick={() => { statusOpen = !statusOpen; navOpen = false; }} title={currentStatus.label || 'Set status'}>
      {currentStatus.emoji || '💬'}
    </button>
    {#if statusOpen}
      <button class="ph-backdrop" onclick={() => statusOpen = false}></button>
      <div class="ph-dropdown ph-status-dropdown">
        {#each STATUS_OPTIONS as opt}
          <button class="ph-dropdown-item" class:active={currentStatus.emoji === opt.emoji} onclick={() => setStatus(opt.emoji, opt.label)}>
            <span class="ph-emoji">{opt.emoji}</span>
            <span class="ph-label">{opt.label}</span>
          </button>
        {/each}
        {#if currentStatus.emoji}
          <button class="ph-dropdown-item ph-clear" onclick={clearStatus}>
            <span class="ph-label">Clear status</span>
          </button>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Nav -->
  <div class="ph-nav-wrapper">
    <button class="ph-nav-toggle" onclick={() => { navOpen = !navOpen; statusOpen = false; }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>
      </svg>
    </button>
    {#if navOpen}
      <button class="ph-backdrop" onclick={() => navOpen = false}></button>
      <div class="ph-dropdown ph-nav-dropdown">
        <a href="/chat" class="ph-dropdown-item" onclick={() => navOpen = false}>Chat</a>
        <a href="/planner" class="ph-dropdown-item" onclick={() => navOpen = false}>Planner</a>
        <a href="/care" class="ph-dropdown-item" onclick={() => navOpen = false}>Care Tracker</a>
        <a href="/files" class="ph-dropdown-item" onclick={() => navOpen = false}>Files</a>
        <a href="/settings" class="ph-dropdown-item" onclick={() => navOpen = false}>Settings</a>
      </div>
    {/if}
  </div>
</header>

<style>
  .page-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 1.5rem;
    padding-top: calc(env(safe-area-inset-top, 0px) + 1.5rem);
  }

  .page-header h1 {
    font-family: var(--font-heading);
    font-size: 1.25rem;
    font-weight: 600;
    margin: 0;
    color: inherit;
  }

  .header-spacer { flex: 1; }

  .back-link {
    color: inherit;
    display: flex;
    align-items: center;
    text-decoration: none;
    opacity: 0.7;
    transition: opacity 150ms ease;
  }

  .back-link:hover { opacity: 1; }

  /* Status toggle */
  .ph-status-wrapper, .ph-nav-wrapper {
    position: relative;
  }

  .ph-status-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.75rem;
    height: 1.75rem;
    font-size: 0.9rem;
    background: transparent;
    border: none;
    border-radius: 50%;
    cursor: pointer;
    transition: background 150ms ease;
    line-height: 1;
  }

  .ph-status-toggle:hover { background: rgba(255, 255, 255, 0.06); }

  .ph-nav-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.3rem;
    color: inherit;
    opacity: 0.5;
    border-radius: 50%;
    background: transparent;
    border: none;
    cursor: pointer;
    transition: all 150ms ease;
  }

  .ph-nav-toggle:hover { opacity: 0.8; background: rgba(255, 255, 255, 0.06); }

  .ph-backdrop {
    position: fixed;
    inset: 0;
    background: transparent;
    z-index: 99;
    border: none;
  }

  .ph-dropdown {
    position: absolute;
    top: calc(100% + 0.5rem);
    right: 0;
    background: var(--bg-surface, #1f1f23);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 1rem;
    padding: 0.4rem;
    min-width: 160px;
    z-index: 100;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    animation: ph-drop-in 150ms ease;
  }

  @keyframes ph-drop-in {
    from { opacity: 0; transform: translateY(-4px) scale(0.95); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  .ph-dropdown-item {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    padding: 0.5rem 0.75rem;
    background: none;
    border: none;
    border-radius: 0.75rem;
    cursor: pointer;
    transition: background 100ms ease;
    text-align: left;
    text-decoration: none;
    font-family: var(--font-body);
    font-size: 0.8rem;
    color: var(--text-secondary, #a1a1aa);
  }

  .ph-dropdown-item:hover {
    background: rgba(255, 255, 255, 0.06);
    color: var(--gold, #5eaba5);
  }

  .ph-dropdown-item.active {
    background: rgba(94, 171, 165, 0.1);
  }

  .ph-emoji { font-size: 1rem; flex-shrink: 0; }

  .ph-label { font-size: 0.8rem; }

  .ph-clear {
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    margin-top: 0.25rem;
    padding-top: 0.5rem;
    justify-content: center;
  }

  .ph-clear .ph-label {
    color: var(--text-muted, #71717a);
    font-size: 0.75rem;
  }

  .ph-status-dropdown { min-width: 200px; }
</style>
