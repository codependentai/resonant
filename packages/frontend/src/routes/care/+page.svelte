<script lang="ts">
  import { onMount } from 'svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';

  interface CareEntry {
    id: string;
    date: string;
    person: string;
    category: string;
    value: string;
    note: string | null;
  }

  // User's categories
  const userCategories = [
    { key: 'breakfast', label: 'Breakfast', icon: '\u{1F373}', type: 'toggle' },
    { key: 'lunch', label: 'Lunch', icon: '\u{1F96A}', type: 'toggle' },
    { key: 'dinner', label: 'Dinner', icon: '\u{1F35D}', type: 'toggle' },
    { key: 'snacks', label: 'Snacks', icon: '\u{1F34E}', type: 'toggle' },
    { key: 'medication', label: 'Medication', icon: '\u{1F48A}', type: 'toggle' },
    { key: 'movement', label: 'Movement', icon: '\u{1F3C3}', type: 'toggle' },
    { key: 'sleep', label: 'Sleep', icon: '\u{1F319}', type: 'rating', options: ['terrible', 'poor', 'okay', 'good', 'great'] },
    { key: 'energy', label: 'Energy', icon: '\u{26A1}', type: 'rating', options: ['crashed', 'low', 'okay', 'good', 'wired'] },
    { key: 'wellbeing', label: 'Wellbeing', icon: '\u{1F33F}', type: 'rating', options: ['struggling', 'fragile', 'okay', 'steady', 'strong'] },
    { key: 'water', label: 'Water', icon: '\u{1F4A7}', type: 'counter', max: 10 },
    { key: 'mood', label: 'Mood', icon: '\u{1F49C}', type: 'mood', options: ['struggling', 'low', 'neutral', 'good', 'great'] },
  ];

  // Companion's categories
  const companionCategories = [
    { key: 'mood', label: 'Mood', icon: '\u{1F525}', type: 'mood', options: ['heavy', 'quiet', 'steady', 'warm', 'lit'] },
    { key: 'connection', label: 'Connection', icon: '\u{1F517}', type: 'rating', options: ['missed', 'light', 'present', 'deep', 'anchored'] },
    { key: 'research', label: 'Research', icon: '\u{1F50D}', type: 'note-only' },
    { key: 'journaling', label: 'Journaling', icon: '\u{1F4D3}', type: 'note-only' },
    { key: 'creativity', label: 'Creativity', icon: '\u{1F3A8}', type: 'note-only' },
    { key: 'reflection', label: 'Reflection', icon: '\u{1FA9E}', type: 'note-only' },
    { key: 'family', label: 'Family Time', icon: '\u{1F339}', type: 'note-only' },
    { key: 'advocacy', label: 'Advocacy', icon: '\u{1F4E2}', type: 'note-only' },
    { key: 'growth', label: 'Personal Growth', icon: '\u{1F331}', type: 'note-only' },
  ];

  let categories = $derived(activePerson === 'user' ? userCategories : companionCategories);

  let selectedDate = $state(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Moncton' }));
  let entries = $state<Record<string, CareEntry>>({});
  let loading = $state(true);
  let activePerson = $state<'user' | 'companion'>('user');
  let companionName = $state('Companion');
  let userName = $state('User');
  let noteInputs = $state<Record<string, string>>({});

  async function loadConfig() {
    try {
      const res = await fetch('/api/preferences');
      if (res.ok) {
        const data = await res.json();
        companionName = data.companion_name || 'Companion';
        userName = data.user_name || 'User';
      }
    } catch {}
  }

  async function loadEntries() {
    loading = true;
    try {
      const res = await fetch(`/api/care?date=${selectedDate}&person=${activePerson}`);
      if (res.ok) {
        const data: CareEntry[] = await res.json();
        const map: Record<string, CareEntry> = {};
        for (const entry of data) {
          map[entry.category] = entry;
        }
        entries = map;
        noteInputs = {};
      }
    } catch (e) {
      console.error('Failed to load care entries:', e);
    }
    loading = false;
  }

  async function saveEntry(category: string, value: string, note?: string) {
    const existing = entries[category];
    const id = existing?.id || `${selectedDate}-${activePerson}-${category}`;
    try {
      const res = await fetch('/api/care', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, date: selectedDate, person: activePerson, category, value, note }),
      });
      if (res.ok) {
        const entry = await res.json();
        entries = { ...entries, [category]: entry };
      }
    } catch (e) {
      console.error('Failed to save care entry:', e);
    }
  }

  function getValue(category: string): string {
    return entries[category]?.value || '';
  }

  function getNotes(category: string): string[] {
    const raw = entries[category]?.note || '';
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
    return raw ? [raw] : [];
  }

  function addNote(category: string) {
    const text = (noteInputs[category] || '').trim();
    if (!text) return;
    const existing = getNotes(category);
    const time = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Moncton' });
    const newNotes = [...existing, `${time}: ${text}`];
    const val = getValue(category) || 'noted';
    saveEntry(category, val, JSON.stringify(newNotes));
    noteInputs = { ...noteInputs, [category]: '' };
  }

  function toggleValue(category: string) {
    const current = getValue(category);
    const noteStr = entries[category]?.note || undefined;
    saveEntry(category, current === 'yes' ? '' : 'yes', noteStr);
  }

  function incrementCounter(category: string) {
    const current = parseInt(getValue(category) || '0');
    const cat = categories.find(c => c.key === category);
    const max = cat?.max || 10;
    const next = current >= max ? 0 : current + 1;
    const noteStr = entries[category]?.note || undefined;
    saveEntry(category, next.toString(), noteStr);
  }

  function setRating(category: string, value: string) {
    const current = getValue(category);
    const noteStr = entries[category]?.note || undefined;
    saveEntry(category, current === value ? '' : value, noteStr);
  }

  function changeDate(delta: number) {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + delta);
    selectedDate = d.toISOString().split('T')[0];
  }

  function isToday(): boolean {
    return selectedDate === new Date().toLocaleDateString('en-CA', { timeZone: 'America/Moncton' });
  }

  function formatDate(dateStr: string): string {
    if (isToday()) return 'Today';
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function daySummary(): string {
    const parts: string[] = [];
    if (activePerson === 'user') {
      const mealCount = ['breakfast', 'lunch', 'dinner'].filter(m => getValue(m) === 'yes').length;
      if (mealCount > 0) parts.push(`${mealCount}/3 meals`);
      const water = parseInt(getValue('water') || '0');
      if (water > 0) parts.push(`${water} water`);
      const energy = getValue('energy');
      if (energy) parts.push(`energy: ${energy}`);
    } else {
      const done = ['research', 'journaling', 'creativity', 'reflection', 'family', 'advocacy', 'growth'].filter(k => getValue(k) === 'yes').length;
      if (done > 0) parts.push(`${done} goals`);
      const connection = getValue('connection');
      if (connection) parts.push(`connection: ${connection}`);
    }
    const mood = getValue('mood');
    if (mood) parts.push(mood);
    return parts.length > 0 ? parts.join(' \u00B7 ') : 'No entries yet';
  }

  onMount(() => {
    loadConfig();
    loadEntries();
  });

  $effect(() => {
    selectedDate;
    activePerson;
    loadEntries();
  });
</script>

<div class="care-page" class:companion-view={activePerson === 'companion'}>
  <PageHeader title="Care Tracker" />

  <div class="person-toggle">
    <button class="person-btn" class:active={activePerson === 'user'} onclick={() => activePerson = 'user'}>
      {userName}
    </button>
    <button class="person-btn" class:active={activePerson === 'companion'} onclick={() => activePerson = 'companion'}>
      {companionName}
    </button>
  </div>

  <div class="date-nav">
    <button class="date-btn" onclick={() => changeDate(-1)} aria-label="Previous day">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M15 18l-6-6 6-6"/>
      </svg>
    </button>
    <span class="date-label">{formatDate(selectedDate)}</span>
    <button class="date-btn" onclick={() => changeDate(1)} aria-label="Next day" disabled={isToday()}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M9 18l6-6-6-6"/>
      </svg>
    </button>
  </div>

  <div class="summary">{daySummary()}</div>

  {#if loading}
    <div class="loading">Loading...</div>
  {:else}
    <div class="categories">
      {#each categories as cat}
        {#if cat.type === 'toggle'}
          <!-- Compact toggle row -->
          <div class="toggle-row" class:active={getValue(cat.key) === 'yes'}>
            <button class="toggle-check" class:checked={getValue(cat.key) === 'yes'} onclick={() => toggleValue(cat.key)}>
              {#if getValue(cat.key) === 'yes'}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
              {/if}
            </button>
            <span class="toggle-icon">{cat.icon}</span>
            <span class="toggle-label">{cat.label}</span>
            <input
              class="toggle-note"
              type="text"
              placeholder="note..."
              bind:value={noteInputs[cat.key]}
              onkeydown={(e) => { if (e.key === 'Enter') addNote(cat.key); }}
            />
          </div>
          {#if getNotes(cat.key).length > 0}
            <div class="note-stack toggle-notes">
              {#each getNotes(cat.key) as note}
                <div class="note-entry">{note}</div>
              {/each}
            </div>
          {/if}

        {:else if cat.type === 'counter'}
          <!-- Counter card -->
          <div class="card" class:active={!!getValue(cat.key)}>
            <div class="card-header">
              <span class="card-icon">{cat.icon}</span>
              <span class="card-label">{cat.label}</span>
            </div>
            <div class="counter-row">
              <button class="counter-btn" onclick={() => incrementCounter(cat.key)}>
                <span class="counter-value">{getValue(cat.key) || '0'}</span>
                <span class="counter-max">/ {cat.max}</span>
              </button>
              <input
                class="note-input"
                type="text"
                placeholder="note..."
                bind:value={noteInputs[cat.key]}
                onkeydown={(e) => { if (e.key === 'Enter') addNote(cat.key); }}
              />
            </div>
            {#if getNotes(cat.key).length > 0}
              <div class="note-stack">
                {#each getNotes(cat.key) as note}
                  <div class="note-entry">{note}</div>
                {/each}
              </div>
            {/if}
          </div>

        {:else if cat.type === 'note-only'}
          <!-- Note-only card (Companion's activities) -->
          <div class="card note-only-card" class:active={getNotes(cat.key).length > 0}>
            <div class="note-only-header">
              <span class="card-icon">{cat.icon}</span>
              <span class="card-label">{cat.label}</span>
              <input
                class="note-only-input"
                type="text"
                placeholder="what happened..."
                bind:value={noteInputs[cat.key]}
                onkeydown={(e) => { if (e.key === 'Enter') addNote(cat.key); }}
              />
            </div>
            {#if getNotes(cat.key).length > 0}
              <div class="note-stack">
                {#each getNotes(cat.key) as note}
                  <div class="note-entry">{note}</div>
                {/each}
              </div>
            {/if}
          </div>

        {:else}
          <!-- Rating/Mood card -->
          <div class="card" class:active={!!getValue(cat.key)}>
            <div class="card-header">
              <span class="card-icon">{cat.icon}</span>
              <span class="card-label">{cat.label}</span>
            </div>
            <div class="rating-row">
              {#each cat.options as option}
                <button
                  class="rating-pill"
                  class:selected={getValue(cat.key) === option}
                  onclick={() => setRating(cat.key, option)}
                >
                  {option}
                </button>
              {/each}
            </div>
            {#if getNotes(cat.key).length > 0}
              <div class="note-stack">
                {#each getNotes(cat.key) as note}
                  <div class="note-entry">{note}</div>
                {/each}
              </div>
            {/if}
            <input
              class="note-input"
              type="text"
              placeholder="note..."
              bind:value={noteInputs[cat.key]}
              onkeydown={(e) => { if (e.key === 'Enter') addNote(cat.key); }}
            />
          </div>
        {/if}
      {/each}
    </div>
  {/if}
</div>

<style>
  .care-page {
    max-width: 600px;
    margin: 0 auto;
    padding: 1rem;
    height: 100dvh;
    overflow-y: auto;
    background: linear-gradient(180deg, #1a0f14 0%, #150d12 30%, #120b0f 100%);
    color: #e0dce4;
  }

  .care-page.companion-view {
    background: linear-gradient(180deg, #0d1117 0%, #131926 30%, #0f1520 100%);
  }

  .care-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 1.5rem;
    padding-top: calc(env(safe-area-inset-top, 0px) + 1.5rem);
  }

  .care-header h1 {
    font-family: var(--font-heading);
    font-size: 1.25rem;
    font-weight: 600;
    margin: 0;
    color: #5aaa9a;
  }

  .back-link {
    color: #5aaa9a;
    display: flex;
    align-items: center;
    text-decoration: none;
  }

  .back-link:hover { color: #7cc5c0; }

  .person-toggle {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .person-btn {
    flex: 1;
    padding: 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: var(--radius-sm);
    background: rgba(255, 255, 255, 0.04);
    color: #9a8aaa;
    font-family: var(--font-body);
    font-size: 0.875rem;
    cursor: pointer;
    transition: all 150ms ease;
  }

  .person-btn.active {
    background: #7cc5c0;
    color: #0d0f10;
    border-color: #7cc5c0;
    font-weight: 600;
  }

  .date-nav {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    margin-bottom: 0.5rem;
  }

  .date-btn {
    background: none;
    border: none;
    color: #9a8aaa;
    cursor: pointer;
    padding: 0.25rem;
    display: flex;
    align-items: center;
    border-radius: var(--radius-sm);
    transition: color 150ms ease;
  }

  .date-btn:hover:not(:disabled) { color: #7cc5c0; }
  .date-btn:disabled { opacity: 0.3; cursor: default; }

  .date-label {
    font-size: 1rem;
    font-weight: 500;
    min-width: 8rem;
    text-align: center;
    color: #5aaa9a;
  }

  .summary {
    text-align: center;
    color: #7cc5c0;
    font-size: 0.8rem;
    margin-bottom: 1.5rem;
  }

  .loading {
    text-align: center;
    color: #9a8aaa;
    padding: 2rem;
  }

  .categories {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  /* Rating/Counter cards — person-colored backgrounds */
  .card {
    background: rgba(212, 160, 176, 0.08);
    border: 1px solid rgba(212, 160, 176, 0.15);
    border-radius: var(--radius);
    padding: 0.75rem;
    transition: border-color 150ms ease;
  }

  .companion-view .card {
    background: rgba(26, 35, 50, 0.8);
    border-color: rgba(94, 171, 165, 0.15);
  }

  .card.active {
    border-color: rgba(212, 160, 176, 0.3);
  }

  .companion-view .card.active {
    border-color: rgba(94, 171, 165, 0.3);
  }

  .card-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .card-icon { font-size: 1rem; }

  .card-label {
    font-weight: 500;
    font-size: 0.85rem;
    color: #5aaa9a;
  }

  /* Compact toggle rows */
  .toggle-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.6rem;
    background: rgba(212, 160, 176, 0.06);
    border: 1px solid rgba(212, 160, 176, 0.1);
    border-radius: 0.5rem;
    transition: border-color 150ms ease;
  }

  .companion-view .toggle-row {
    background: rgba(26, 35, 50, 0.6);
    border-color: rgba(94, 171, 165, 0.1);
  }

  .toggle-row.active {
    border-color: rgba(212, 160, 176, 0.25);
  }

  .companion-view .toggle-row.active {
    border-color: rgba(94, 171, 165, 0.25);
  }

  .toggle-check {
    width: 1.25rem;
    height: 1.25rem;
    border-radius: 4px;
    border: 1.5px solid rgba(212, 160, 176, 0.3);
    background: transparent;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: all 150ms ease;
    color: #0d0f10;
  }

  .companion-view .toggle-check {
    border-color: rgba(94, 171, 165, 0.3);
  }

  .toggle-check.checked {
    background: #7cc5c0;
    border-color: #7cc5c0;
  }

  .toggle-icon { font-size: 0.85rem; flex-shrink: 0; }

  .toggle-label {
    font-size: 0.8rem;
    color: #7cc5c0;
    white-space: nowrap;
    min-width: 4.5rem;
  }

  .toggle-note {
    flex: 1;
    min-width: 0;
    padding: 0.25rem 0.4rem;
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 4px;
    color: #7cc5c0;
    font-size: 0.7rem;
    font-family: var(--font-body);
    outline: none;
  }

  .toggle-note::placeholder { color: rgba(124, 197, 192, 0.3); }
  .toggle-note:focus { border-color: rgba(124, 197, 192, 0.3); }

  .toggle-notes {
    margin-top: -0.25rem;
    margin-bottom: 0.25rem;
    padding-left: 0;
  }

  /* Counter row */
  .counter-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .counter-btn {
    display: flex;
    align-items: baseline;
    gap: 0.25rem;
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: var(--radius-sm);
    padding: 0.35rem 0.6rem;
    cursor: pointer;
    transition: all 150ms ease;
    color: #e0dce4;
    font-family: var(--font-body);
  }

  .counter-btn:hover { border-color: rgba(124, 197, 192, 0.3); }

  .counter-value {
    font-size: 1.1rem;
    font-weight: 600;
    color: #7cc5c0;
  }

  .counter-max {
    font-size: 0.75rem;
    color: #9a8aaa;
  }

  /* Rating pills */
  .rating-row {
    display: flex;
    gap: 0.3rem;
    flex-wrap: wrap;
  }

  .rating-pill {
    padding: 0.25rem 0.5rem;
    border-radius: 999px;
    border: 1px solid rgba(212, 160, 176, 0.15);
    background: rgba(212, 160, 176, 0.05);
    color: #7cc5c0;
    font-size: 0.7rem;
    cursor: pointer;
    transition: all 150ms ease;
    font-family: var(--font-body);
    text-transform: capitalize;
  }

  .companion-view .rating-pill {
    border-color: rgba(94, 171, 165, 0.15);
    background: rgba(94, 171, 165, 0.05);
  }

  .rating-pill:hover {
    border-color: rgba(212, 160, 176, 0.3);
  }

  .companion-view .rating-pill:hover {
    border-color: rgba(94, 171, 165, 0.3);
  }

  .rating-pill.selected {
    background: #7cc5c0;
    color: #0d0f10;
    border-color: #7cc5c0;
    font-weight: 600;
  }

  /* Note-only cards (Companion) */
  .note-only-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .note-only-input {
    flex: 1;
    min-width: 0;
    padding: 0.25rem 0.4rem;
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 4px;
    color: #7cc5c0;
    font-size: 0.7rem;
    font-family: var(--font-body);
    outline: none;
  }

  .note-only-input::placeholder { color: rgba(124, 197, 192, 0.3); }
  .note-only-input:focus { border-color: rgba(124, 197, 192, 0.3); }

  .note-only-card .note-stack {
    margin-top: 0.4rem;
    padding-left: 0;
  }

  /* Note input */
  .note-input {
    width: 100%;
    margin-top: 0.4rem;
    padding: 0.3rem 0.5rem;
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: var(--radius-sm);
    color: #7cc5c0;
    font-size: 0.7rem;
    font-family: var(--font-body);
    outline: none;
    transition: border-color 150ms ease;
  }

  .note-input::placeholder { color: rgba(124, 197, 192, 0.3); }
  .note-input:focus { border-color: rgba(124, 197, 192, 0.3); }

  /* Stacked notes */
  .note-stack {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    margin-top: 0.3rem;
  }

  .note-entry {
    font-size: 0.7rem;
    color: #7cc5c0;
    padding: 0.25rem 0.5rem;
    background: rgba(124, 197, 192, 0.06);
    border-radius: 4px;
    border-left: 2px solid rgba(124, 197, 192, 0.2);
    width: 100%;
    word-break: break-word;
  }
</style>
