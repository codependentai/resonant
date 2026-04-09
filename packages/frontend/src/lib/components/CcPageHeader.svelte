<script lang="ts">
  import { page } from '$app/state';

  let { title, backHref = '/cc' }: { title: string; backHref?: string } = $props();
  let navOpen = $state(false);

  const pages = [
    { href: '/chat', label: 'Chat', icon: 'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z' },
    { href: '/cc', label: 'Home', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4' },
    { href: '/cc/planner', label: 'Planner', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' },
    { href: '/cc/care', label: 'Care', icon: 'M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z' },
    { href: '/cc/calendar', label: 'Calendar', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
    { href: '/cc/cycle', label: 'Cycle', icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' },
    { href: '/cc/pets', label: 'Pets', icon: 'M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21H7a2 2 0 01-2-2v-7a2 2 0 012-2h1.5L12 3l2 7z' },
    { href: '/cc/lists', label: 'Lists', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M12 11l0 6M9 14l6 0' },
    { href: '/cc/finances', label: 'Finances', icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8V6m0 8v2m9-6a9 9 0 11-18 0 9 9 0 0118 0z' },
    { href: '/cc/stats', label: 'Stats', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
  ];

  let currentPath = $derived(page.url.pathname);

  function closeNav() { navOpen = false; }

  function handleNavKey(e: KeyboardEvent) {
    if (e.key === 'Escape') closeNav();
  }
</script>

<svelte:window onkeydown={navOpen ? handleNavKey : undefined} />

<header class="page-header">
  <div class="header-left">
    <a href={backHref} class="back-btn" aria-label="Go back">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M19 12H5M12 19l-7-7 7-7"/>
      </svg>
    </a>
    <h1>{title}</h1>
  </div>

  <div class="header-right">
    <div class="nav-wrap">
      <button
        class="nav-toggle"
        onclick={() => navOpen = !navOpen}
        aria-label="Navigation menu"
        aria-expanded={navOpen}
        aria-haspopup="menu"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="3" y1="12" x2="21" y2="12"/>
          <line x1="3" y1="6" x2="21" y2="6"/>
          <line x1="3" y1="18" x2="21" y2="18"/>
        </svg>
      </button>
      {#if navOpen}
        <button class="nav-backdrop" onclick={closeNav} aria-hidden="true" tabindex="-1"></button>
        <nav class="nav-dropdown">
          {#each pages as p}
            <a
              href={p.href}
              class="nav-item"
              class:active={currentPath === p.href}
              onclick={closeNav}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d={p.icon}/>
              </svg>
              {p.label}
            </a>
          {/each}
        </nav>
      {/if}
    </div>
  </div>
</header>

<style>
  .page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2) var(--space-4);
    border-bottom: 1px solid var(--border);
    background: var(--bg-primary);
    position: sticky;
    top: 0;
    z-index: 100;
    min-height: 56px;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .back-btn {
    color: var(--text-secondary);
    text-decoration: none;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    border-radius: 10px;
    transition: all var(--transition);
  }

  .back-btn:hover { color: var(--text-primary); background: var(--bg-hover); }
  .back-btn:active { transform: scale(0.93); }

  h1 {
    font-size: var(--text-lg);
    font-weight: 600;
    color: var(--text-primary);
  }

  .header-right {
    display: flex;
    align-items: center;
  }

  .nav-wrap { position: relative; }

  .nav-toggle {
    width: 44px;
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    border-radius: 10px;
    transition: all var(--transition);
  }

  .nav-toggle:hover { color: var(--text-primary); background: var(--bg-hover); }
  .nav-toggle:active { transform: scale(0.93); }
  .nav-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .nav-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.3);
    border: none;
    z-index: 99;
  }

  .nav-dropdown {
    position: absolute;
    right: 0;
    top: calc(100% + var(--space-2));
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    padding: var(--space-2);
    min-width: 12rem;
    z-index: 100;
    box-shadow: var(--shadow-md);
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: 0 var(--space-3);
    min-height: 44px;
    color: var(--text-secondary);
    text-decoration: none;
    border-radius: 10px;
    font-size: var(--text-base);
    transition: all var(--transition);
  }

  .nav-item:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .nav-item:active {
    background: var(--bg-active);
  }

  .nav-item.active {
    color: var(--accent);
    background: var(--gold-ember);
  }

  .nav-item:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
</style>
