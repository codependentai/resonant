<script lang="ts">
  import { onMount } from 'svelte';
  import '../../resonant.css';
  import ResSkeleton from '$lib/components/ResSkeleton.svelte';
  import { CC_API, todayStr } from '$lib/utils/cc';

  let loading = $state(true);
  let error = $state('');
  let taskCount = $state(0);
  let eventCount = $state(0);
  let careCount = $state(0);
  let petAlerts = $state<any[]>([]);
  let countdowns = $state<any[]>([]);
  let wins = $state<any[]>([]);
  let topTasks = $state<any[]>([]);
  let todayEvents = $state<any[]>([]);
  let showAddCountdown = $state(false);
  let cdTitle = $state('');
  let cdDate = $state('');
  let cdEmoji = $state('');
  let defaultPerson = $state('');
  const todayLabel = new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  const sections = [
    { href: '/cc/planner', label: 'Planner', desc: 'Tasks & schedule', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' },
    { href: '/cc/care', label: 'Care', desc: 'Wellness tracking', icon: 'M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z' },
    { href: '/cc/calendar', label: 'Calendar', desc: 'Events', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
    { href: '/cc/cycle', label: 'Cycle', desc: 'Predictions', icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' },
    { href: '/cc/pets', label: 'Pets', desc: 'Care & meds', icon: 'M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21H7a2 2 0 01-2-2v-7a2 2 0 012-2h1.5L12 3l2 7z' },
    { href: '/cc/lists', label: 'Lists', desc: 'Shopping & more', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M12 11l0 6M9 14l6 0' },
    { href: '/cc/finances', label: 'Finances', desc: 'Expenses', icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8V6m0 8v2m9-6a9 9 0 11-18 0 9 9 0 0118 0z' },
    { href: '/cc/stats', label: 'Stats', desc: 'Trends & insights', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
  ];

  async function load() {
    try {
      const today = todayStr();
      const person = defaultPerson || 'default';
      const [careRes, taskRes, eventRes, petRes, countRes, winRes] = await Promise.all([
        fetch(`${CC_API}/care?date=${today}&person=${person}`),
        fetch(`${CC_API}/tasks?status=active`),
        fetch(`${CC_API}/events?start_date=${today}&end_date=${today}`),
        fetch(`${CC_API}/pets/upcoming?days=2`),
        fetch(`${CC_API}/countdowns`),
        fetch(`${CC_API}/wins?date=${today}`),
      ]);

      const [careData, taskData, eventData, petData, countData, winData] = await Promise.all([
        careRes.json(), taskRes.json(), eventRes.json(), petRes.json(), countRes.json(), winRes.json(),
      ]);

      careCount = (careData.entries || []).filter((e: any) => e.value === 'true' || (e.value && !isNaN(Number(e.value)) && e.category !== 'water')).length;
      const allTasks = taskData.tasks || [];
      taskCount = allTasks.length;
      topTasks = allTasks.slice(0, 3);
      const allEvents = eventData.events || [];
      eventCount = allEvents.length;
      todayEvents = allEvents.slice(0, 3);
      petAlerts = (petData.items || []).filter((p: any) => p.overdue || p.isToday);
      countdowns = (countData.countdowns || []).filter((c: any) => c.days_until >= 0).slice(0, 4);
      wins = winData.wins || [];
    } catch (e: any) {
      error = 'Failed to load dashboard';
    }
    loading = false;
  }

  async function addCountdown() {
    if (!cdTitle.trim() || !cdDate) return;
    await fetch(`${CC_API}/countdowns`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: cdTitle.trim(), target_date: cdDate, emoji: cdEmoji || undefined }),
    });
    cdTitle = ''; cdDate = ''; cdEmoji = ''; showAddCountdown = false;
    await load();
  }

  onMount(async () => {
    try {
      const res = await fetch(`${CC_API}/config`);
      if (res.ok) {
        const config = await res.json();
        defaultPerson = config.default_person || '';
      }
    } catch { /* use empty default */ }
    await load();
  });
</script>

<main class="home-shell">
  <div class="home-hero">
    <div class="hero-copy">
      <span class="hero-eyebrow">Command center</span>
      <h1>Home</h1>
      <p>{todayLabel}</p>
    </div>

    <div class="hero-actions">
      <a href="/chat" class="hero-primary">Open chat</a>
      <a href="/cc/planner" class="hero-secondary">Planner</a>
      <a href="/cc/calendar" class="hero-secondary">Calendar</a>
    </div>
  </div>

  <div class="home-content">
    {#if loading}
      <ResSkeleton variant="stats" />
      <ResSkeleton variant="cards" rows={4} />
    {:else if error}
      <div class="res-empty home-empty">
        <p class="res-empty__message">{error}</p>
        <button class="res-btn res-btn--ghost" onclick={load}>Retry</button>
      </div>
    {:else}
      <section class="summary-grid">
        <a href="/cc/planner" class="summary-card">
          <span class="summary-label">Active tasks</span>
          <strong>{taskCount}</strong>
        </a>
        <a href="/cc/calendar" class="summary-card">
          <span class="summary-label">Today</span>
          <strong>{eventCount}</strong>
        </a>
        <a href="/cc/care" class="summary-card">
          <span class="summary-label">Care tracked</span>
          <strong>{careCount}</strong>
        </a>
        <a href="/cc/pets" class="summary-card">
          <span class="summary-label">Alerts</span>
          <strong>{petAlerts.length}</strong>
        </a>
      </section>

      <section class="feature-grid">
        {#if petAlerts.length > 0}
          <a href="/cc/pets" class="feature-card feature-card--urgent">
            <div class="section-head">
              <span class="res-section-title" style="margin: 0;">Pet care needed</span>
              <span class="feature-badge">{petAlerts.length}</span>
            </div>
            <div class="feature-list">
              {#each petAlerts as alert}
                <div class="alert-line">
                  <strong>{alert.pet}</strong>
                  <span>{alert.name}</span>
                  <span class="alert-badge">{alert.overdue ? 'Overdue' : 'Today'}</span>
                </div>
              {/each}
            </div>
          </a>
        {/if}

        <a href="/cc/calendar" class="feature-card">
          <div class="section-head">
            <span class="res-section-title" style="margin: 0;">Today schedule</span>
            <span class="feature-badge">{eventCount}</span>
          </div>
          {#if todayEvents.length > 0}
            <div class="feature-list">
              {#each todayEvents as ev}
                <div class="event-line">
                  <span class="event-time">{ev.start_time || 'All day'}</span>
                  <span class="res-truncate">{ev.title}</span>
                </div>
              {/each}
              {#if eventCount > 3}
                <span class="more-link">+{eventCount - 3} more</span>
              {/if}
            </div>
          {:else}
            <p class="feature-empty">No events scheduled today.</p>
          {/if}
        </a>

        <a href="/cc/planner" class="feature-card">
          <div class="section-head">
            <span class="res-section-title" style="margin: 0;">Active tasks</span>
            <span class="feature-badge">{taskCount}</span>
          </div>
          {#if topTasks.length > 0}
            <div class="feature-list">
              {#each topTasks as task}
                <div class="task-line">
                  {#if task.priority >= 2}<span class="priority urgent">!!</span>
                  {:else if task.priority >= 1}<span class="priority high">!</span>
                  {/if}
                  <span class="res-truncate">{task.text}</span>
                  {#if task.project_name}<span class="project-tag">{task.project_name}</span>{/if}
                </div>
              {/each}
              {#if taskCount > 3}
                <span class="more-link">+{taskCount - 3} more</span>
              {/if}
            </div>
          {:else}
            <p class="feature-empty">No active tasks right now.</p>
          {/if}
        </a>

        <div class="feature-card">
          <div class="section-head">
            <span class="res-section-title" style="margin: 0;">Countdowns</span>
            <button class="res-btn res-btn--icon" onclick={() => showAddCountdown = !showAddCountdown} aria-label="Add countdown">+</button>
          </div>

          {#if showAddCountdown}
            <form class="res-form home-form" onsubmit={(e) => { e.preventDefault(); addCountdown(); }}>
              <div class="res-form-row">
                <input type="text" bind:value={cdEmoji} placeholder="Emoji" class="res-input" style="max-width: 4rem;" />
                <input type="text" bind:value={cdTitle} placeholder="What are you counting down to?" class="res-input" />
              </div>
              <div class="res-form-row">
                <input type="date" bind:value={cdDate} class="res-input" />
                <button type="submit" class="res-btn res-btn--primary">Add</button>
              </div>
            </form>
          {/if}

          {#if countdowns.length > 0}
            <div class="countdown-row">
              {#each countdowns as c}
                <div class="res-chip">
                  {#if c.emoji}<span>{c.emoji}</span>{/if}
                  <span class="res-truncate">{c.title}</span>
                  <strong class="cd-days">{c.days_until === 0 ? 'Today' : c.days_until + 'd'}</strong>
                </div>
              {/each}
            </div>
          {:else}
            <p class="feature-empty">No countdowns yet.</p>
          {/if}
        </div>

        {#if wins.length > 0}
          <div class="feature-card feature-card--accent">
            <span class="res-section-title">Today's win</span>
            {#each wins as w}
              <p class="win-text">{w.who}: {w.text}</p>
            {/each}
          </div>
        {/if}
      </section>

      <section class="launch-grid">
        {#each sections as s}
          <a href={s.href} class="launch-card">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
              <path d={s.icon}/>
            </svg>
            <div class="launch-text">
              <span class="launch-label">{s.label}</span>
              <span class="launch-desc">{s.desc}</span>
            </div>
          </a>
        {/each}
      </section>
    {/if}
  </div>
</main>

<style>
  .alert-line {
    font-size: var(--text-base);
    padding: var(--space-1) 0;
  }

  .alert-badge {
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--color-danger);
    margin-left: var(--space-2);
  }

  .event-line {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-1) 0;
    font-size: var(--text-base);
  }

  .event-time {
    font-size: var(--text-sm);
    color: var(--text-muted);
    min-width: 4rem;
    flex-shrink: 0;
  }

  .task-line {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) 0;
    font-size: var(--text-base);
  }

  .priority { font-weight: 700; flex-shrink: 0; }
  .priority.urgent { color: var(--color-error); }
  .priority.high { color: var(--color-warning); }

  .project-tag {
    font-size: var(--text-xs);
    color: var(--accent);
    flex-shrink: 0;
  }

  .more-link {
    display: block;
    font-size: var(--text-sm);
    color: var(--text-muted);
    margin-top: var(--space-2);
  }

  .countdown-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .cd-days { color: var(--accent); }

  .win-text {
    font-size: var(--text-base);
    color: var(--text-secondary);
    line-height: 1.5;
  }

  .home-shell {
    min-height: 100dvh;
    padding: calc(env(safe-area-inset-top, 0px) + 1rem) 1rem calc(env(safe-area-inset-bottom, 0px) + 1rem);
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .home-hero {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1rem;
    padding: 1.25rem;
    border: 1px solid var(--border);
    border-radius: 1.5rem;
    background:
      radial-gradient(circle at top left, rgba(94, 171, 165, 0.12), transparent 28%),
      var(--bg-secondary);
    box-shadow: var(--shadow-md);
  }

  .hero-copy {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    min-width: 0;
  }

  .hero-eyebrow {
    font-size: 0.6875rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-muted);
  }

  .hero-copy h1 {
    font-size: 1.75rem;
    line-height: 1;
    color: var(--text-primary);
    overflow-wrap: anywhere;
  }

  .hero-copy p {
    color: var(--text-secondary);
    font-size: 0.925rem;
    overflow-wrap: anywhere;
  }

  .hero-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .hero-primary,
  .hero-secondary {
    min-height: 44px;
    padding: 0 0.95rem;
    border-radius: 0.875rem;
    font-size: 0.8125rem;
    font-weight: 600;
    transition: all var(--transition);
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .hero-primary {
    background: var(--accent);
    color: var(--bg-primary);
  }

  .hero-primary:hover {
    background: var(--accent-hover);
  }

  .hero-secondary {
    border: 1px solid var(--border);
    background: var(--bg-surface);
    color: var(--text-secondary);
  }

  .hero-secondary:hover {
    color: var(--text-primary);
    border-color: var(--border-hover);
    background: var(--bg-hover);
  }

  .home-content {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    flex: 1;
    min-height: 0;
  }

  .summary-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.75rem;
  }

  .summary-card {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 1rem;
    border-radius: 1rem;
    border: 1px solid var(--border);
    background: var(--bg-surface);
    color: var(--text-primary);
    transition: all var(--transition);
    min-width: 0;
  }

  .summary-card:hover {
    background: var(--bg-hover);
    border-color: var(--border-hover);
  }

  .summary-label {
    font-size: 0.6875rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
  }

  .summary-card strong {
    font-size: 1.35rem;
    line-height: 1;
  }

  .feature-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.75rem;
  }

  .feature-card {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    padding: 1rem;
    border: 1px solid var(--border);
    border-radius: 1.25rem;
    background: var(--bg-surface);
    color: var(--text-primary);
    box-shadow: var(--shadow-sm);
  }

  .feature-card--urgent {
    border-color: rgba(176, 112, 104, 0.28);
    background: rgba(176, 112, 104, 0.08);
  }

  .feature-card--accent {
    border-color: rgba(94, 171, 165, 0.22);
    background: rgba(94, 171, 165, 0.08);
  }

  .section-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.75rem;
    min-width: 0;
  }

  .feature-badge {
    font-size: 0.6875rem;
    padding: 0.25rem 0.5rem;
    border-radius: 999px;
    border: 1px solid var(--border);
    color: var(--text-muted);
  }

  .feature-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 0;
  }

  .feature-empty {
    color: var(--text-muted);
    font-size: 0.875rem;
  }

  .alert-line,
  .event-line,
  .task-line {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    font-size: 0.875rem;
    min-width: 0;
  }

  .alert-line {
    flex-wrap: wrap;
  }

  .alert-line strong {
    color: var(--text-primary);
  }

  .alert-badge {
    font-size: 0.6875rem;
    font-weight: 700;
    color: var(--color-danger);
    background: rgba(176, 112, 104, 0.14);
    border-radius: 999px;
    padding: 0.15rem 0.45rem;
  }

  .event-time {
    font-size: 0.75rem;
    color: var(--text-muted);
    min-width: 4rem;
    flex-shrink: 0;
  }

  .priority {
    font-weight: 700;
    flex-shrink: 0;
  }

  .priority.urgent {
    color: var(--color-error);
  }

  .priority.high {
    color: var(--color-warning);
  }

  .project-tag {
    margin-left: auto;
    font-size: 0.6875rem;
    color: var(--accent);
    white-space: normal;
    text-align: right;
    overflow-wrap: anywhere;
  }

  .more-link {
    display: block;
    margin-top: 0.25rem;
    color: var(--text-muted);
    font-size: 0.8125rem;
  }

  .countdown-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    min-width: 0;
  }

  .cd-days {
    color: var(--accent);
  }

  .win-text {
    font-size: 0.925rem;
    color: var(--text-secondary);
    line-height: 1.5;
  }

  .launch-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.75rem;
  }

  .launch-card {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    padding: 1rem;
    border: 1px solid var(--border);
    border-radius: 1rem;
    background: var(--bg-surface);
    color: var(--text-primary);
    transition: all var(--transition);
    min-width: 0;
  }

  .launch-card:hover {
    background: var(--bg-hover);
    border-color: var(--border-hover);
    transform: translateY(-1px);
  }

  .launch-card svg {
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .launch-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .launch-label {
    font-size: 0.9rem;
    font-weight: 600;
  }

  .launch-desc {
    font-size: 0.75rem;
    color: var(--text-muted);
    overflow-wrap: anywhere;
  }

  .home-shell :global(.res-truncate) {
    white-space: normal;
    overflow: visible;
    text-overflow: clip;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .home-form {
    margin: 0;
    padding: 0.85rem;
  }

  .home-empty {
    min-height: 20rem;
  }

  @media (max-width: 960px) {
    .summary-grid,
    .feature-grid,
    .launch-grid {
      grid-template-columns: 1fr 1fr;
    }

    .home-hero {
      flex-direction: column;
      align-items: flex-start;
    }

    .hero-actions {
      justify-content: flex-start;
    }
  }

  @media (max-width: 640px) {
    .home-shell {
      padding:
        calc(env(safe-area-inset-top, 0px) + 0.75rem)
        0.75rem
        calc(env(safe-area-inset-bottom, 0px) + 0.85rem);
    }

    .summary-grid,
    .feature-grid,
    .launch-grid {
      grid-template-columns: 1fr;
    }

    .home-hero {
      padding: 1rem;
      border-radius: 1.15rem;
    }

    .hero-copy h1 {
      font-size: 1.5rem;
    }

    .section-head,
    .task-line {
      align-items: flex-start;
    }

    .event-line {
      align-items: flex-start;
      flex-wrap: wrap;
    }

    .event-time {
      min-width: 0;
    }

    .launch-card {
      padding: 0.9rem;
    }
  }
</style>
