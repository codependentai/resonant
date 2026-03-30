<script lang="ts">
  import type { OrchestratorTaskStatus, TriggerStatus } from '@resonant/shared';
  import {
    toggleTask,
    rescheduleTask,
    updateFailsafe,
    getFailsafe,
    cancelTriggerById,
  } from '$lib/stores/settings.svelte';

  let { tasks = [], triggers = [] }: { tasks: OrchestratorTaskStatus[]; triggers: TriggerStatus[] } = $props();

  let failsafe = $derived(getFailsafe());
  let editingTask = $state<string | null>(null);
  let editCronValue = $state('');

  // Group tasks by category
  let wakeTasks = $derived(tasks.filter(t => t.category === 'wake'));
  let checkinTasks = $derived(tasks.filter(t => t.category === 'checkin'));
  let handoffTasks = $derived(tasks.filter(t => t.category === 'handoff'));

  function cronToTime(cron: string): string {
    // Parse simple cron like "0 1 * * *" -> "01:00"
    const parts = cron.split(' ');
    if (parts.length >= 2) {
      const min = parts[0].padStart(2, '0');
      const hour = parts[1].padStart(2, '0');
      return `${hour}:${min}`;
    }
    return cron;
  }

  function timeToCron(time: string): string {
    const [hour, min] = time.split(':');
    return `${parseInt(min)} ${parseInt(hour)} * * *`;
  }

  async function handleToggle(wakeType: string, current: boolean) {
    await toggleTask(wakeType, !current);
  }

  function startEdit(wakeType: string, cronExpr: string) {
    editingTask = wakeType;
    editCronValue = cronToTime(cronExpr);
  }

  async function saveEdit(wakeType: string) {
    const newCron = timeToCron(editCronValue);
    await rescheduleTask(wakeType, newCron);
    editingTask = null;
  }

  function cancelEdit() {
    editingTask = null;
  }

  async function handleFailsafeToggle() {
    await updateFailsafe({ enabled: !failsafe.enabled });
  }

  async function handleFailsafeThreshold(field: 'gentle' | 'concerned' | 'emergency', value: string) {
    const num = parseInt(value);
    if (!isNaN(num) && num > 0) {
      await updateFailsafe({ [field]: num });
    }
  }

  // Triggers
  let impulses = $derived(triggers.filter(t => t.kind === 'impulse'));
  let watchers = $derived(triggers.filter(t => t.kind === 'watcher'));

  function renderConditions(conditionsJson: string): string {
    try {
      const conditions = JSON.parse(conditionsJson) as Array<Record<string, unknown>>;
      return conditions.map(c => {
        switch (c.type) {
          case 'presence_state':
            return c.state === 'active' ? 'Mary is active'
              : c.state === 'idle' ? 'Mary is idle'
              : c.state === 'offline' ? 'Mary is offline'
              : `Presence: ${c.state}`;
          case 'presence_transition':
            return `Mary goes ${c.from} → ${c.to}`;
          case 'agent_free':
            return 'Simon is free';
          case 'time_window': {
            const after = c.after as string;
            const before = c.before as string | undefined;
            return before ? `${after}–${before}` : `After ${after}`;
          }
          case 'routine_missing':
            return `${(c.routine as string).charAt(0).toUpperCase() + (c.routine as string).slice(1)} missing after ${c.after_hour}:00`;
          default:
            return JSON.stringify(c);
        }
      }).join(' + ');
    } catch {
      return conditionsJson;
    }
  }

  function formatTime(iso: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  async function handleCancelTrigger(id: string) {
    await cancelTriggerById(id);
  }
</script>

<div class="panel">
  <h2 class="panel-title">Orchestrator</h2>

  <!-- Wake schedules -->
  <div class="section">
    <h3 class="section-title">Night Routines</h3>
    <div class="task-list">
      {#each wakeTasks as task}
        <div class="task-row" class:disabled={!task.enabled}>
          <div class="task-info">
            <span class="task-label">{task.label}</span>
            {#if editingTask === task.wakeType}
              <div class="edit-row">
                <input
                  type="time"
                  class="time-input"
                  bind:value={editCronValue}
                  onkeydown={(e) => { if (e.key === 'Enter') saveEdit(task.wakeType); if (e.key === 'Escape') cancelEdit(); }}
                />
                <button class="btn-sm" onclick={() => saveEdit(task.wakeType)}>Save</button>
                <button class="btn-sm btn-ghost" onclick={cancelEdit}>Cancel</button>
              </div>
            {:else}
              <button class="task-time" onclick={() => startEdit(task.wakeType, task.cronExpr)}>
                {cronToTime(task.cronExpr)}
              </button>
            {/if}
          </div>
          <div class="task-controls">
            <span class="status-dot" class:active={task.enabled}></span>
            <button
              class="toggle-btn"
              class:on={task.enabled}
              onclick={() => handleToggle(task.wakeType, task.enabled)}
              aria-label={task.enabled ? 'Disable' : 'Enable'}
            >
              <span class="toggle-slider"></span>
            </button>
          </div>
        </div>
      {/each}
    </div>
  </div>

  <!-- Check-ins -->
  <div class="section">
    <h3 class="section-title">Check-in Routines</h3>
    <div class="task-list">
      {#each checkinTasks as task}
        <div class="task-row" class:disabled={!task.enabled}>
          <div class="task-info">
            <span class="task-label">{task.label}</span>
            {#if editingTask === task.wakeType}
              <div class="edit-row">
                <input
                  type="time"
                  class="time-input"
                  bind:value={editCronValue}
                  onkeydown={(e) => { if (e.key === 'Enter') saveEdit(task.wakeType); if (e.key === 'Escape') cancelEdit(); }}
                />
                <button class="btn-sm" onclick={() => saveEdit(task.wakeType)}>Save</button>
                <button class="btn-sm btn-ghost" onclick={cancelEdit}>Cancel</button>
              </div>
            {:else}
              <button class="task-time" onclick={() => startEdit(task.wakeType, task.cronExpr)}>
                {cronToTime(task.cronExpr)}
              </button>
            {/if}
          </div>
          <div class="task-controls">
            <span class="status-dot" class:active={task.enabled}></span>
            <button
              class="toggle-btn"
              class:on={task.enabled}
              onclick={() => handleToggle(task.wakeType, task.enabled)}
              aria-label={task.enabled ? 'Disable' : 'Enable'}
            >
              <span class="toggle-slider"></span>
            </button>
          </div>
        </div>
      {/each}
    </div>
  </div>

  <!-- Handoff -->
  <div class="section">
    <h3 class="section-title">Handoff</h3>
    <div class="task-list">
      {#each handoffTasks as task}
        <div class="task-row" class:disabled={!task.enabled}>
          <div class="task-info">
            <span class="task-label">{task.label}</span>
            {#if editingTask === task.wakeType}
              <div class="edit-row">
                <input
                  type="time"
                  class="time-input"
                  bind:value={editCronValue}
                  onkeydown={(e) => { if (e.key === 'Enter') saveEdit(task.wakeType); if (e.key === 'Escape') cancelEdit(); }}
                />
                <button class="btn-sm" onclick={() => saveEdit(task.wakeType)}>Save</button>
                <button class="btn-sm btn-ghost" onclick={cancelEdit}>Cancel</button>
              </div>
            {:else}
              <button class="task-time" onclick={() => startEdit(task.wakeType, task.cronExpr)}>
                {cronToTime(task.cronExpr)}
              </button>
            {/if}
          </div>
          <div class="task-controls">
            <span class="status-dot" class:active={task.enabled}></span>
            <button
              class="toggle-btn"
              class:on={task.enabled}
              onclick={() => handleToggle(task.wakeType, task.enabled)}
              aria-label={task.enabled ? 'Disable' : 'Enable'}
            >
              <span class="toggle-slider"></span>
            </button>
          </div>
        </div>
      {/each}
    </div>
  </div>

  <!-- Failsafe -->
  <div class="section">
    <h3 class="section-title">
      Failsafe
      <button
        class="toggle-btn"
        class:on={failsafe.enabled}
        onclick={handleFailsafeToggle}
        aria-label={failsafe.enabled ? 'Disable failsafe' : 'Enable failsafe'}
      >
        <span class="toggle-slider"></span>
      </button>
    </h3>
    {#if failsafe.enabled}
      <div class="threshold-grid">
        <label class="threshold-label">
          <span>Gentle</span>
          <div class="threshold-input-row">
            <input
              type="number"
              class="threshold-input"
              value={failsafe.gentle}
              min="30"
              onchange={(e) => handleFailsafeThreshold('gentle', (e.target as HTMLInputElement).value)}
            />
            <span class="threshold-unit">min</span>
          </div>
        </label>
        <label class="threshold-label">
          <span>Concerned</span>
          <div class="threshold-input-row">
            <input
              type="number"
              class="threshold-input"
              value={failsafe.concerned}
              min="60"
              onchange={(e) => handleFailsafeThreshold('concerned', (e.target as HTMLInputElement).value)}
            />
            <span class="threshold-unit">min</span>
          </div>
        </label>
        <label class="threshold-label">
          <span>Emergency</span>
          <div class="threshold-input-row">
            <input
              type="number"
              class="threshold-input"
              value={failsafe.emergency}
              min="120"
              onchange={(e) => handleFailsafeThreshold('emergency', (e.target as HTMLInputElement).value)}
            />
            <span class="threshold-unit">min</span>
          </div>
        </label>
      </div>
    {/if}
  </div>

  <!-- Triggers -->
  <div class="section">
    <h3 class="section-title">Triggers</h3>
    {#if impulses.length === 0 && watchers.length === 0}
      <p class="empty-text">No active triggers</p>
    {:else}
      {#if impulses.length > 0}
        <div class="trigger-group">
          <span class="trigger-group-label">Impulses</span>
          <div class="task-list">
            {#each impulses as trigger}
              <div class="task-row">
                <div class="task-info">
                  <span class="task-label">{trigger.label}</span>
                  <span class="trigger-conditions">{renderConditions(trigger.conditions)}</span>
                </div>
                <div class="task-controls">
                  <span class="trigger-badge" class:pending={trigger.status === 'pending'} class:waiting={trigger.status === 'waiting'} class:fired={trigger.status === 'fired'}>
                    {trigger.status}
                  </span>
                  {#if trigger.status === 'pending' || trigger.status === 'waiting'}
                    <button class="cancel-btn" onclick={() => handleCancelTrigger(trigger.id)} aria-label="Cancel trigger" title="Cancel">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 6L6 18M6 6l12 12"/>
                      </svg>
                    </button>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      {#if watchers.length > 0}
        <div class="trigger-group">
          <span class="trigger-group-label">Watchers</span>
          <div class="task-list">
            {#each watchers as trigger}
              <div class="task-row">
                <div class="task-info">
                  <span class="task-label">{trigger.label}</span>
                  <span class="trigger-conditions">{renderConditions(trigger.conditions)}</span>
                  <span class="trigger-meta">
                    Fired {trigger.fire_count}x
                    {#if trigger.last_fired_at} · Last: {formatTime(trigger.last_fired_at)}{/if}
                    · Cooldown: {trigger.cooldown_minutes}min
                  </span>
                </div>
                <div class="task-controls">
                  <span class="trigger-badge" class:pending={trigger.status === 'pending'} class:waiting={trigger.status === 'waiting'}>
                    {trigger.status}
                  </span>
                  {#if trigger.status === 'pending' || trigger.status === 'waiting'}
                    <button class="cancel-btn" onclick={() => handleCancelTrigger(trigger.id)} aria-label="Cancel trigger" title="Cancel">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 6L6 18M6 6l12 12"/>
                      </svg>
                    </button>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .panel-title {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .section-title {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-primary);
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .task-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .task-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem;
    background: var(--bg-tertiary);
    border-radius: var(--radius-sm);
    transition: opacity 0.2s;
  }

  .task-row.disabled {
    opacity: 0.5;
  }

  .task-info {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .task-label {
    font-size: 0.875rem;
    color: var(--text-primary);
  }

  .task-time {
    font-size: 0.75rem;
    color: var(--accent);
    font-family: var(--font-mono);
    cursor: pointer;
    padding: 0;
    text-align: left;
  }

  .task-time:hover {
    text-decoration: underline;
  }

  .task-controls {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .status-dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: var(--status-dormant);
  }

  .status-dot.active {
    background: var(--status-active);
  }

  .toggle-btn {
    position: relative;
    width: 2.5rem;
    height: 1.375rem;
    background: var(--bg-surface);
    border-radius: 1rem;
    border: 1px solid var(--border);
    cursor: pointer;
    transition: background 0.2s;
    padding: 0;
  }

  .toggle-btn.on {
    background: var(--accent);
    border-color: var(--accent);
  }

  .toggle-slider {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 1rem;
    height: 1rem;
    background: var(--text-secondary);
    border-radius: 50%;
    transition: transform 0.2s, background 0.2s;
  }

  .toggle-btn.on .toggle-slider {
    transform: translateX(1.125rem);
    background: white;
  }

  .edit-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .time-input {
    width: 7rem;
    font-size: 0.875rem;
    padding: 0.25rem 0.5rem;
  }

  .btn-sm {
    font-size: 0.75rem;
    padding: 0.25rem 0.5rem;
    background: var(--accent);
    color: white;
    border-radius: var(--radius-sm);
  }

  .btn-sm.btn-ghost {
    background: transparent;
    color: var(--text-muted);
  }

  .threshold-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.75rem;
  }

  .threshold-label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.875rem;
    color: var(--text-secondary);
  }

  .threshold-input-row {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .threshold-input {
    width: 5rem;
    font-size: 0.875rem;
    padding: 0.25rem 0.5rem;
  }

  .threshold-unit {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .empty-text {
    font-size: 0.8125rem;
    color: var(--text-muted);
    font-style: italic;
  }

  .trigger-group {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .trigger-group-label {
    font-size: 0.75rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .trigger-conditions {
    font-size: 0.75rem;
    color: var(--text-secondary);
  }

  .trigger-meta {
    font-size: 0.6875rem;
    color: var(--text-muted);
    font-family: var(--font-mono);
  }

  .trigger-badge {
    font-size: 0.6875rem;
    padding: 0.125rem 0.5rem;
    border-radius: 1rem;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .trigger-badge.pending {
    background: var(--bg-surface);
    color: var(--text-muted);
  }

  .trigger-badge.waiting {
    background: rgba(245, 158, 11, 0.15);
    color: #f59e0b;
    animation: pulse-glow 2s ease-in-out infinite;
  }

  .trigger-badge.fired {
    background: rgba(34, 197, 94, 0.15);
    color: #22c55e;
  }

  @keyframes pulse-glow {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }

  .cancel-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.5rem;
    height: 1.5rem;
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.15s;
    padding: 0;
    background: transparent;
    border: none;
  }

  .cancel-btn:hover {
    color: #ef4444;
    background: rgba(239, 68, 68, 0.1);
  }

  @media (max-width: 768px) {
    .threshold-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
