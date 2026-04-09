<script lang="ts">
  import { onMount } from 'svelte';
  import '../../../resonant.css';
  import CcPageHeader from '$lib/components/CcPageHeader.svelte';
  import ResRating from '$lib/components/ResRating.svelte';
  import ResEmpty from '$lib/components/ResEmpty.svelte';
  import ResSkeleton from '$lib/components/ResSkeleton.svelte';
  import { CC_API, daysLabel } from '$lib/utils/cc';

  let status = $state<any>({});
  let predict = $state<any>({});
  let history = $state<any[]>([]);
  let loading = $state(true);
  let showLog = $state(false);
  let logFlow = $state('');
  let logMood = $state('');
  let logEnergy = $state(0);
  let logNotes = $state('');

  async function load() {
    try {
      const [sRes, pRes, hRes] = await Promise.all([
        fetch(`${CC_API}/cycle/status`), fetch(`${CC_API}/cycle/predict`), fetch(`${CC_API}/cycle/history`),
      ]);
      status = await sRes.json(); predict = await pRes.json();
      const hData = await hRes.json(); history = hData.cycles || [];
    } catch { /* empty state */ }
    loading = false;
  }

  async function startPeriod() { await fetch(`${CC_API}/cycle/period/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); await load(); }
  async function endPeriod() { await fetch(`${CC_API}/cycle/period/end`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); await load(); }

  async function logDaily() {
    await fetch(`${CC_API}/cycle/log`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flow: logFlow || undefined, mood: logMood || undefined, energy: logEnergy || undefined, notes: logNotes || undefined }),
    });
    showLog = false; logFlow = ''; logMood = ''; logEnergy = 0; logNotes = ''; await load();
  }

  onMount(load);
</script>

<main class="res-page">
  <CcPageHeader title="Cycle" />

  <div class="res-content">
    {#if loading}
      <ResSkeleton variant="cards" rows={3} />
    {:else if status.noData}
      <ResEmpty message="No cycle data yet" actionLabel="Log period start" onaction={startPeriod} />
    {:else}
      <!-- Status card -->
      <div class="res-card res-card--elevated">
        <div class="status-top">
          <span class="phase-badge {status.phase}">{status.phase}</span>
          <div class="status-info">
            <span class="cycle-day">Day {status.cycleDay}</span>
            <span class="cycle-meta">
              {#if status.onPeriod}On period (started {status.periodStarted})
              {:else}Next period in ~{daysLabel(status.daysUntilPeriod)}
              {/if}
            </span>
            {#if status.inPMSWindow}<span class="pms-flag">PMS window</span>{/if}
          </div>
        </div>
      </div>

      <!-- Actions -->
      <div class="res-row" style="gap: var(--space-3);">
        {#if status.onPeriod}
          <button class="res-btn res-btn--primary" onclick={endPeriod}>End period</button>
        {:else}
          <button class="res-btn res-btn--primary" onclick={startPeriod}>Start period</button>
        {/if}
        <button class="res-btn res-btn--ghost" onclick={() => showLog = !showLog}>Log today</button>
      </div>

      {#if showLog}
        <div class="res-form">
          <label class="res-form-row">
            <span class="form-label">Flow</span>
            <select bind:value={logFlow} class="res-select">
              <option value="">--</option>
              <option value="none">None</option>
              <option value="spotting">Spotting</option>
              <option value="light">Light</option>
              <option value="medium">Medium</option>
              <option value="heavy">Heavy</option>
            </select>
          </label>
          <ResRating label="Energy" value={logEnergy} onchange={(n) => logEnergy = n} />
          <label class="res-form-row">
            <span class="form-label">Mood</span>
            <input type="text" bind:value={logMood} class="res-input" placeholder="How are you feeling?" />
          </label>
          <label class="res-form-row">
            <span class="form-label">Notes</span>
            <input type="text" bind:value={logNotes} class="res-input" placeholder="Anything else..." />
          </label>
          <button class="res-btn res-btn--primary" style="align-self: flex-end;" onclick={logDaily}>Save</button>
        </div>
      {/if}

      <!-- Predictions -->
      {#if predict.nextPeriod}
        <div class="res-card">
          <span class="res-section-title">Predictions</span>
          <div class="res-grid-2">
            <div class="pred-item"><span class="pred-label">Next period</span><span>{predict.nextPeriod}</span></div>
            <div class="pred-item"><span class="pred-label">Ovulation</span><span>{predict.ovulation}</span></div>
            <div class="pred-item"><span class="pred-label">Fertile window</span><span>{predict.fertileWindow?.start} - {predict.fertileWindow?.end}</span></div>
            <div class="pred-item"><span class="pred-label">PMS window</span><span>{predict.pmsWindow?.start} - {predict.pmsWindow?.end}</span></div>
          </div>
        </div>
      {/if}

      <!-- History -->
      {#if history.length > 0}
        <div class="res-card">
          <span class="res-section-title">History</span>
          {#each history as cycle}
            <div class="history-row">
              <span>{cycle.start_date} - {cycle.end_date || 'ongoing'}</span>
              {#if cycle.end_date}
                <span class="hist-len">{Math.round((new Date(cycle.end_date).getTime() - new Date(cycle.start_date).getTime()) / 86400000) + 1}d</span>
              {/if}
            </div>
          {/each}
        </div>
      {/if}

      <!-- Recent logs -->
      {#if status.recentLogs?.length > 0}
        <div class="res-card">
          <span class="res-section-title">Recent logs</span>
          {#each status.recentLogs as log}
            <div class="log-row">
              <span class="log-date">{log.date}</span>
              {#if log.flow}<span class="res-chip" style="min-height: auto; padding: var(--space-1) var(--space-2); font-size: var(--text-xs);">{log.flow}</span>{/if}
              {#if log.energy}<span class="log-tag">energy: {log.energy}</span>{/if}
              {#if log.mood}<span class="log-tag">{log.mood}</span>{/if}
            </div>
          {/each}
        </div>
      {/if}
    {/if}
  </div>
</main>

<style>
  .status-top { display: flex; align-items: center; gap: var(--space-4); }

  .phase-badge {
    padding: var(--space-2) var(--space-4);
    border-radius: 22px;
    font-size: var(--text-sm);
    font-weight: 600;
    text-transform: capitalize;
    min-height: 36px;
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }
  .phase-badge.menstrual { background: var(--color-danger-muted); color: var(--color-danger); }
  .phase-badge.follicular { background: rgba(110, 154, 168, 0.15); color: #6e9aa8; }
  .phase-badge.ovulation { background: var(--color-warning-muted); color: var(--color-warning); }
  .phase-badge.luteal { background: rgba(140, 120, 160, 0.15); color: #8c78a0; }

  .status-info { display: flex; flex-direction: column; }
  .cycle-day { font-size: var(--text-xl); font-weight: 700; }
  .cycle-meta { font-size: var(--text-sm); color: var(--text-muted); }
  .pms-flag { font-size: var(--text-xs); color: var(--color-danger); font-weight: 600; margin-top: var(--space-1); }

  .form-label { font-size: var(--text-sm); color: var(--text-muted); min-width: 4rem; flex-shrink: 0; }

  .pred-item {
    display: flex;
    flex-direction: column;
    padding: var(--space-3);
    background: var(--bg-tertiary);
    border-radius: var(--radius-sm);
    font-size: var(--text-base);
  }
  .pred-label { font-size: var(--text-xs); color: var(--text-muted); text-transform: uppercase; margin-bottom: var(--space-1); }

  .history-row {
    display: flex;
    justify-content: space-between;
    padding: var(--space-2) 0;
    border-bottom: 1px solid var(--border);
    font-size: var(--text-base);
  }
  .history-row:last-child { border-bottom: none; }
  .hist-len { color: var(--text-muted); font-size: var(--text-sm); }

  .log-row { display: flex; gap: var(--space-3); align-items: center; padding: var(--space-2) 0; font-size: var(--text-sm); }
  .log-date { color: var(--text-muted); min-width: 5.5rem; flex-shrink: 0; }
  .log-tag { font-size: var(--text-xs); padding: var(--space-1) var(--space-2); background: var(--bg-tertiary); border-radius: var(--radius-sm); }
</style>
