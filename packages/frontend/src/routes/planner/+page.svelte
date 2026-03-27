<script lang="ts">
  import { onMount } from 'svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';

  interface Task {
    id: string;
    date: string;
    person: string;
    title: string;
    completed: number;
    sort_order: number;
    created_at: string;
    updated_at: string;
  }

  interface ScheduleEntry {
    id: string;
    date: string;
    time: string;
    title: string;
    note: string | null;
    sort_order: number;
    created_at: string;
    updated_at: string;
  }

  interface Project {
    id: string;
    title: string;
    person: string;
    status: string;
    note: string | null;
    sort_order: number;
    created_at: string;
    updated_at: string;
  }

  // Use local date, not UTC — prevents day-ahead bug after 9pm Atlantic
  let selectedDate = $state(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Moncton' }));

  // Data
  let weekSchedule = $state<ScheduleEntry[]>([]);
  let weekTasks = $state<Record<string, Task[]>>({});
  let dayTasks = $state<Task[]>([]);
  let daySchedule = $state<ScheduleEntry[]>([]);
  let projects = $state<Project[]>([]);
  let loading = $state(true);

  // Form state
  let newTaskTitle = $state('');
  let newTaskPerson = $state<'user' | 'companion'>('user');
  let newScheduleTime = $state('');
  let newScheduleTitle = $state('');
  let newProjectTitle = $state('');
  let newProjectPerson = $state<'user' | 'companion' | 'both'>('both');
  let newProjectNote = $state('');
  let newProjectDueDate = $state('');
  let showAddTask = $state(false);
  let showAddSchedule = $state(false);
  let showAddProject = $state(false);

  // Names
  let companionName = $state('Companion');
  let userName = $state('User');

  function getWeekStart(dateStr: string): string {
    const d = new Date(dateStr + 'T12:00:00');
    const day = d.getDay(); // 0=Sunday
    d.setDate(d.getDate() - day); // Sunday start
    return d.toISOString().split('T')[0];
  }

  function getWeekDays(startDate: string): string[] {
    const days: string[] = [];
    const d = new Date(startDate + 'T12:00:00');
    for (let i = 0; i < 7; i++) {
      days.push(d.toISOString().split('T')[0]);
      d.setDate(d.getDate() + 1);
    }
    return days;
  }

  let weekStart = $derived(getWeekStart(selectedDate));
  let weekDays = $derived(getWeekDays(weekStart));
  let today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Moncton' });

  function formatDayName(dateStr: string): string {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short' });
  }

  function formatDayNum(dateStr: string): string {
    const d = new Date(dateStr + 'T12:00:00');
    return d.getDate().toString();
  }

  function formatMonth(dateStr: string): string {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { month: 'short' });
  }

  function formatFullDate(dateStr: string): string {
    if (dateStr === today) return 'Today';
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  }

  function formatTime12(time24: string): string {
    if (!time24 || !time24.includes(':')) return time24 || '';
    const [h, m] = time24.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return time24;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
  }

  function personLabel(person: string): string {
    if (person === 'user') return userName;
    if (person === 'companion') return companionName;
    return 'Both';
  }

  // Data loading
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

  async function loadWeekData() {
    loading = true;
    try {
      const [schedRes, gcalWeekRes, ...taskResults] = await Promise.all([
        fetch(`/api/planner/schedule/week?start=${weekStart}`),
        fetch(`/api/planner/gcal/week?start=${weekStart}`),
        ...weekDays.map(d => fetch(`/api/planner/tasks?date=${d}`)),
      ]);
      const sched = schedRes.ok ? await schedRes.json() : [];
      const gcalWeek = gcalWeekRes.ok ? await gcalWeekRes.json() : [];
      weekSchedule = [...sched, ...gcalWeek].sort((a: any, b: any) => (a.time || '').localeCompare(b.time || ''));
      const tasksMap: Record<string, Task[]> = {};
      for (let i = 0; i < weekDays.length; i++) {
        if (taskResults[i].ok) {
          tasksMap[weekDays[i]] = await taskResults[i].json();
        }
      }
      weekTasks = tasksMap;
    } catch (e) {
      console.error('Failed to load week data:', e);
    }
    loading = false;
  }

  async function loadDayData() {
    loading = true;
    try {
      const [tasksRes, schedRes, projRes, gcalRes] = await Promise.all([
        fetch(`/api/planner/tasks?date=${selectedDate}`),
        fetch(`/api/planner/schedule?date=${selectedDate}`),
        fetch('/api/planner/projects?status=active'),
        fetch(`/api/planner/gcal?date=${selectedDate}`),
      ]);
      if (tasksRes.ok) dayTasks = await tasksRes.json();
      if (schedRes.ok) {
        const sched = await schedRes.json();
        const gcalEvents = gcalRes.ok ? await gcalRes.json() : [];
        daySchedule = [...sched, ...gcalEvents].sort((a: any, b: any) => (a.time || '').localeCompare(b.time || ''));
      } else {
        if (gcalRes.ok) daySchedule = await gcalRes.json();
      }
      if (projRes.ok) projects = await projRes.json();
    } catch (e) {
      console.error('Failed to load day data:', e);
    }
    loading = false;
  }

  async function loadData() {
    await Promise.all([loadWeekData(), loadDayData()]);
  }

  // Actions
  async function addTask() {
    if (!newTaskTitle.trim()) return;
    try {
      const res = await fetch('/api/planner/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: selectedDate, person: newTaskPerson, title: newTaskTitle.trim() }),
      });
      if (res.ok) {
        newTaskTitle = '';
        showAddTask = false;
        await loadDayData();
      }
    } catch (e) {
      console.error('Failed to add task:', e);
    }
  }

  async function toggleTask(task: Task) {
    try {
      await fetch(`/api/planner/tasks/${task.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed: task.completed ? 0 : 1 }),
      });
      await loadDayData();
    } catch (e) {
      console.error('Failed to toggle task:', e);
    }
  }

  async function deleteTask(id: string) {
    try {
      await fetch(`/api/planner/tasks/${id}`, { method: 'DELETE' });
      await loadDayData();
    } catch (e) {
      console.error('Failed to delete task:', e);
    }
  }

  async function addScheduleEntry() {
    if (!newScheduleTime || !newScheduleTitle.trim()) return;
    try {
      const res = await fetch('/api/planner/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: selectedDate, time: newScheduleTime, title: newScheduleTitle.trim() }),
      });
      if (res.ok) {
        newScheduleTime = '';
        newScheduleTitle = '';
        showAddSchedule = false;
        await loadDayData();
      }
    } catch (e) {
      console.error('Failed to add schedule entry:', e);
    }
  }

  async function deleteScheduleEntry(id: string) {
    try {
      await fetch(`/api/planner/schedule/${id}`, { method: 'DELETE' });
      await loadDayData();
    } catch (e) {
      console.error('Failed to delete schedule entry:', e);
    }
  }

  async function addProject() {
    if (!newProjectTitle.trim()) return;
    try {
      const res = await fetch('/api/planner/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newProjectTitle.trim(), person: newProjectPerson, note: newProjectNote.trim() || undefined, due_date: newProjectDueDate || undefined }),
      });
      if (res.ok) {
        newProjectTitle = '';
        newProjectNote = '';
        newProjectDueDate = '';
        showAddProject = false;
        await loadDayData();
      }
    } catch (e) {
      console.error('Failed to add project:', e);
    }
  }

  async function archiveProject(id: string) {
    try {
      await fetch(`/api/planner/projects/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'archived' }),
      });
      await loadDayData();
    } catch (e) {
      console.error('Failed to archive project:', e);
    }
  }

  async function deleteProject(id: string) {
    try {
      await fetch(`/api/planner/projects/${id}`, { method: 'DELETE' });
      await loadDayData();
    } catch (e) {
      console.error('Failed to delete project:', e);
    }
  }

  function selectDay(dateStr: string) {
    selectedDate = dateStr;
  }

  function changeWeek(delta: number) {
    const d = new Date(weekStart + 'T12:00:00');
    d.setDate(d.getDate() + delta * 7);
    selectedDate = d.toISOString().split('T')[0];
  }

  function getScheduleForDay(dateStr: string): ScheduleEntry[] {
    return weekSchedule.filter(e => e.date === dateStr);
  }

  function getTaskSummary(dateStr: string): { done: number; total: number } {
    const tasks = weekTasks[dateStr] || [];
    return { done: tasks.filter(t => t.completed).length, total: tasks.length };
  }

  onMount(() => {
    loadConfig();
    loadData();
  });

  $effect(() => {
    weekStart;
    loadWeekData();
  });

  $effect(() => {
    selectedDate;
    loadDayData();
  });
</script>

<div class="planner-page">
  <PageHeader title="Planner" />

  <!-- Week nav arrows + mini week bar -->
  <div class="week-nav">
    <button class="nav-btn" onclick={() => changeWeek(-1)}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M15 18l-6-6 6-6"/>
      </svg>
    </button>
    <div class="mini-week">
      {#each weekDays as day}
        <button
          class="mini-day"
          class:is-today={day === today}
          class:is-selected={day === selectedDate}
          onclick={() => selectDay(day)}
        >
          <span class="mini-day-name">{formatDayName(day)}</span>
          <span class="mini-day-num">{formatDayNum(day)}</span>
        </button>
      {/each}
    </div>
    <button class="nav-btn" onclick={() => changeWeek(1)}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M9 18l6-6-6-6"/>
      </svg>
    </button>
  </div>

  <!-- Week overview — stacked full-width day banners -->
  <div class="week-stack">
    {#each weekDays as day}
      {@const summary = getTaskSummary(day)}
      {@const sched = getScheduleForDay(day)}
      <button class="day-banner" class:is-today={day === today} class:is-selected={day === selectedDate} onclick={() => selectDay(day)}>
        <div class="banner-left">
          <span class="banner-day">{formatDayName(day)}</span>
          <span class="banner-num">{formatDayNum(day)}</span>
          {#if summary.total > 0}
            <span class="banner-tasks">{summary.done}/{summary.total}</span>
          {/if}
        </div>
        {#if sched.length > 0}
          <div class="banner-sched">
            {#each sched as entry}
              <span class="banner-event">{formatTime12(entry.time)} {entry.title}</span>
            {/each}
          </div>
        {/if}
      </button>
    {/each}
  </div>

  <!-- Selected day: Tasks + Projects -->
  <div class="day-sections">
    <div class="selected-date-label">{formatFullDate(selectedDate)}</div>

    <!-- Tasks -->
    <section class="section">
      <div class="section-header">
        <h2>Tasks</h2>
        <button class="add-btn" onclick={() => showAddTask = !showAddTask}>+</button>
      </div>

      {#if showAddTask}
        <div class="add-form">
          <div class="person-toggle-small">
            <button class="ptog" class:active={newTaskPerson === 'user'} onclick={() => newTaskPerson = 'user'}>{userName}</button>
            <button class="ptog" class:active={newTaskPerson === 'companion'} onclick={() => newTaskPerson = 'companion'}>{companionName}</button>
          </div>
          <input type="text" bind:value={newTaskTitle} placeholder="Task title..." class="text-input"
            onkeydown={(e) => { if (e.key === 'Enter') addTask(); }} />
          <button class="save-btn" onclick={addTask}>Add</button>
        </div>
      {/if}

      {#if dayTasks.length === 0}
        <div class="empty-state">No tasks yet</div>
      {:else}
        <div class="tasks-list">
          {#each dayTasks as task}
            <div class="task-item" class:completed={!!task.completed}>
              <button class="checkbox" class:checked={!!task.completed} onclick={() => toggleTask(task)}>
                {#if task.completed}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                {/if}
              </button>
              <div class="task-content">
                <span class="task-title">{task.title}</span>
                <span class="task-person">{personLabel(task.person)}</span>
              </div>
              <button class="delete-btn" onclick={() => deleteTask(task.id)} aria-label="Delete">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
              </button>
            </div>
          {/each}
        </div>
      {/if}
    </section>

    <!-- Projects -->
    <section class="section">
      <div class="section-header">
        <h2>Projects</h2>
        <button class="add-btn" onclick={() => showAddProject = !showAddProject}>+</button>
      </div>

      {#if showAddProject}
        <div class="add-form">
          <div class="person-toggle-small">
            <button class="ptog" class:active={newProjectPerson === 'user'} onclick={() => newProjectPerson = 'user'}>{userName}</button>
            <button class="ptog" class:active={newProjectPerson === 'companion'} onclick={() => newProjectPerson = 'companion'}>{companionName}</button>
            <button class="ptog" class:active={newProjectPerson === 'both'} onclick={() => newProjectPerson = 'both'}>Both</button>
          </div>
          <input type="text" bind:value={newProjectTitle} placeholder="Project name..." class="text-input"
            onkeydown={(e) => { if (e.key === 'Enter') addProject(); }} />
          <input type="text" bind:value={newProjectNote} placeholder="Note (optional)..." class="text-input" />
          <div style="display:flex;align-items:center;gap:8px">
            <label style="color:var(--text-secondary);font-size:0.8rem;white-space:nowrap">Due date</label>
            <input type="date" bind:value={newProjectDueDate} class="text-input" style="flex:1" />
          </div>
          <button class="save-btn" onclick={addProject}>Add</button>
        </div>
      {/if}

      {#if projects.length === 0}
        <div class="empty-state">No active projects</div>
      {:else}
        <div class="projects-list">
          {#each projects as project}
            <div class="project-item">
              <div class="project-content">
                <div class="project-title-row">
                  <span class="project-title">{project.title}</span>
                  <span class="project-person-tag">{personLabel(project.person)}</span>
                </div>
                {#if project.note}
                  <div class="project-note">{project.note}</div>
                {/if}
                <div class="project-meta">
                  <span>Created {new Date(project.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                  {#if project.due_date}
                    {@const due = new Date(project.due_date + 'T00:00:00')}
                    {@const now = new Date()}
                    {@const daysLeft = Math.ceil((due.getTime() - now.getTime()) / 86400000)}
                    <span class="due-date" class:overdue={daysLeft < 0} class:urgent={daysLeft >= 0 && daysLeft <= 3}>
                      Due {due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      {#if daysLeft < 0}(overdue){:else if daysLeft === 0}(today){:else if daysLeft <= 3}({daysLeft}d left){/if}
                    </span>
                  {/if}
                </div>
              </div>
              <div class="project-actions">
                <button class="archive-btn" onclick={() => archiveProject(project.id)} title="Archive">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </button>
                <button class="delete-btn" onclick={() => deleteProject(project.id)} aria-label="Delete">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 6L6 18M6 6l12 12"/>
                  </svg>
                </button>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </section>
  </div>
</div>

<style>
  .planner-page {
    max-width: 600px;
    margin: 0 auto;
    padding: 1rem;
    height: 100dvh;
    overflow-y: auto;
    background: linear-gradient(180deg, #1a1025 0%, #150e1e 30%, #120d1a 100%);
    color: #e0dce4;
  }

  .planner-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 1.5rem;
    padding-top: calc(env(safe-area-inset-top, 0px) + 1.5rem);
  }

  .planner-header h1 {
    font-family: var(--font-heading);
    font-size: 1.25rem;
    font-weight: 600;
    margin: 0;
    color: #c8a0d4;
  }

  .back-link, .back-btn {
    color: #c8a0d4;
    display: flex;
    align-items: center;
    text-decoration: none;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
  }

  .back-link:hover, .back-btn:hover {
    color: #d4b0e0;
  }

  .loading {
    text-align: center;
    color: var(--text-muted);
    padding: 2rem;
  }

  /* Week nav */
  .week-nav {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    margin-bottom: 0.75rem;
  }

  .nav-btn {
    background: none;
    border: none;
    cursor: pointer;
    padding: 0.25rem;
    display: flex;
    align-items: center;
    border-radius: var(--radius-sm);
    transition: color var(--transition);
    flex-shrink: 0;
  }

  /* Week stack — full-width day banners */
  .week-stack {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-bottom: 1.25rem;
  }

  .day-banner {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.5rem 0.75rem;
    background: rgba(180, 160, 200, 0.06);
    border: 1px solid rgba(160, 120, 180, 0.12);
    border-radius: 0.5rem;
    cursor: pointer;
    transition: all 150ms ease;
    text-align: left;
    width: 100%;
  }

  .day-banner:hover {
    background: rgba(180, 160, 200, 0.1);
    border-color: rgba(160, 120, 180, 0.25);
  }

  .day-banner.is-today {
    border-color: rgba(138, 106, 158, 0.4);
  }

  .day-banner.is-selected {
    background: rgba(160, 120, 180, 0.12);
    border-color: #8a6a9e;
  }

  .banner-left {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    min-width: 7rem;
    flex-shrink: 0;
  }

  .banner-day {
    font-size: 0.7rem;
    color: #9a8aaa;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    width: 2rem;
  }

  .banner-num {
    font-size: 0.95rem;
    font-weight: 600;
    color: #e0dce4;
    width: 1.5rem;
  }

  .day-banner.is-today .banner-num {
    color: #5eaba5;
  }

  .banner-tasks {
    font-size: 0.65rem;
    color: #9a8aaa;
    background: rgba(180, 160, 200, 0.1);
    padding: 0.1rem 0.35rem;
    border-radius: 4px;
  }

  .banner-sched {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
  }

  .banner-event {
    font-size: 0.65rem;
    color: #5eaba5;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .selected-date-label {
    font-size: 0.85rem;
    font-weight: 500;
    color: #c8a0d4;
    margin-bottom: 0.75rem;
  }

  /* Day sections */
  .day-sections {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .section {
    background: rgba(180, 160, 200, 0.08);
    border: 1px solid rgba(160, 120, 180, 0.2);
    border-radius: var(--radius);
    padding: 1rem;
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.75rem;
  }

  .section-header h2 {
    font-family: var(--font-heading);
    font-size: 1rem;
    font-weight: 600;
    margin: 0;
    color: #c8a0d4;
  }

  .add-btn {
    width: 1.75rem;
    height: 1.75rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--bg-surface);
    color: var(--accent);
    font-size: 1.1rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all var(--transition);
  }

  .add-btn:hover {
    border-color: var(--accent-muted);
    background: var(--accent);
    color: var(--bg-primary);
  }

  .empty-state {
    color: var(--text-muted);
    font-size: 0.8rem;
    text-align: center;
    padding: 0.75rem 0;
  }

  /* Add forms */
  .add-form {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
    padding: 0.75rem;
    background: var(--bg-surface);
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
  }

  .text-input {
    width: 100%;
    padding: 0.5rem 0.625rem;
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-size: 0.85rem;
    font-family: var(--font-body);
    outline: none;
    transition: border-color var(--transition);
  }

  .text-input::placeholder {
    color: var(--text-muted);
  }

  .text-input:focus {
    border-color: var(--accent-muted);
  }

  .time-input {
    padding: 0.5rem 0.625rem;
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-size: 0.85rem;
    font-family: var(--font-body);
    outline: none;
    width: auto;
  }

  .time-input:focus {
    border-color: var(--accent-muted);
  }

  .person-toggle-small {
    display: flex;
    gap: 0.375rem;
  }

  .ptog {
    padding: 0.25rem 0.5rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--bg-secondary);
    color: var(--text-secondary);
    font-size: 0.75rem;
    cursor: pointer;
    transition: all var(--transition);
    font-family: var(--font-body);
  }

  .ptog.active {
    background: var(--accent);
    color: var(--bg-primary);
    border-color: var(--accent);
    font-weight: 600;
  }

  .save-btn {
    align-self: flex-end;
    padding: 0.375rem 0.875rem;
    background: var(--accent);
    color: var(--bg-primary);
    border: none;
    border-radius: var(--radius-sm);
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    transition: background var(--transition);
    font-family: var(--font-body);
  }

  .save-btn:hover {
    background: var(--accent-hover);
  }

  /* Schedule list */
  .schedule-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .schedule-item {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--border);
  }

  .schedule-item:last-child {
    border-bottom: none;
  }

  .schedule-time {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--accent);
    min-width: 5rem;
    white-space: nowrap;
  }

  .schedule-title {
    font-size: 0.85rem;
    flex: 1;
  }

  .schedule-note {
    font-size: 0.7rem;
    color: var(--text-muted);
  }

  /* Tasks list */
  .tasks-list {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .task-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.375rem 0;
    transition: opacity var(--transition);
  }

  .task-item.completed {
    opacity: 0.5;
  }

  .checkbox {
    width: 1.375rem;
    height: 1.375rem;
    border-radius: var(--radius-sm);
    border: 1.5px solid var(--border);
    background: var(--bg-surface);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all var(--transition);
    flex-shrink: 0;
    color: var(--bg-primary);
  }

  .checkbox.checked {
    background: var(--accent);
    border-color: var(--accent);
  }

  .task-content {
    flex: 1;
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    min-width: 0;
  }

  .task-title {
    font-size: 0.85rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #5eaba5;
  }

  .completed .task-title {
    text-decoration: line-through;
    color: var(--text-muted);
  }

  .task-person {
    font-size: 0.65rem;
    color: var(--text-muted);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .delete-btn {
    color: var(--text-muted);
    background: none;
    border: none;
    cursor: pointer;
    padding: 0.25rem;
    display: flex;
    align-items: center;
    border-radius: var(--radius-sm);
    transition: color var(--transition);
    flex-shrink: 0;
    opacity: 0;
    transition: opacity var(--transition), color var(--transition);
  }

  .task-item:hover .delete-btn,
  .schedule-item:hover .delete-btn,
  .project-item:hover .delete-btn {
    opacity: 1;
  }

  .delete-btn:hover {
    color: #ef4444;
  }

  /* Projects */
  .projects-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .project-item {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--border);
  }

  .project-item:last-child {
    border-bottom: none;
  }

  .project-content {
    flex: 1;
    min-width: 0;
  }

  .project-title-row {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
  }

  .project-title {
    font-size: 0.85rem;
    font-weight: 500;
    color: #5eaba5;
  }

  .project-person-tag {
    font-size: 0.6rem;
    padding: 0.125rem 0.375rem;
    border-radius: 999px;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    color: var(--text-muted);
    white-space: nowrap;
  }

  .project-note {
    font-size: 0.75rem;
    color: var(--text-muted);
    margin-top: 0.25rem;
  }

  .project-meta {
    display: flex;
    gap: 0.75rem;
    font-size: 0.7rem;
    color: var(--text-muted);
    margin-top: 0.25rem;
    opacity: 0.7;
  }
  .project-meta .due-date {
    opacity: 1;
  }
  .project-meta .due-date.urgent {
    color: #e8a040;
  }
  .project-meta .due-date.overdue {
    color: #e05555;
  }

  .project-actions {
    display: flex;
    gap: 0.25rem;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity var(--transition);
  }

  .project-item:hover .project-actions {
    opacity: 1;
  }

  .archive-btn {
    color: var(--accent);
    background: none;
    border: none;
    cursor: pointer;
    padding: 0.25rem;
    display: flex;
    align-items: center;
    border-radius: var(--radius-sm);
    transition: color var(--transition);
  }

  .archive-btn:hover {
    color: var(--accent-hover);
  }

  /* Mini week nav */
  .mini-week {
    display: flex;
    gap: 0.25rem;
    justify-content: space-between;
    flex: 1;
  }

  .mini-day {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.15rem;
    padding: 0.4rem 0.25rem;
    background: transparent;
    border: 1.5px solid transparent;
    border-radius: 0.75rem;
    cursor: pointer;
    transition: all 150ms ease;
  }

  .mini-day:hover {
    background: rgba(180, 160, 200, 0.08);
  }

  .mini-day.is-today .mini-day-num {
    color: #5eaba5;
    font-weight: 700;
  }

  .mini-day.is-selected {
    background: rgba(160, 120, 180, 0.15);
    border-color: #8a6a9e;
  }

  .mini-day-name {
    font-size: 0.6rem;
    color: #9a8aaa;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .mini-day-num {
    font-size: 0.95rem;
    font-weight: 500;
    color: #e0dce4;
  }

  /* Day schedule preview (compact) */
  .day-schedule-preview {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-bottom: 1rem;
    padding: 0.6rem 0.75rem;
    background: rgba(180, 160, 200, 0.06);
    border-radius: var(--radius-sm);
    border-left: 2px solid #8a6a9e;
  }

  .schedule-preview-item {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .schedule-preview-time {
    font-size: 0.7rem;
    font-weight: 600;
    color: #c8a0d4;
    min-width: 4.5rem;
    white-space: nowrap;
  }

  .schedule-preview-title {
    font-size: 0.75rem;
    color: #5eaba5;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Nav buttons color update */
  .nav-btn {
    color: #9a8aaa;
  }
  .nav-btn:hover {
    color: #c8a0d4;
  }
  .week-label {
    color: #e0dce4;
  }
  .day-name {
    color: #9a8aaa;
  }
  .day-num {
    color: #e0dce4;
  }
  .day-sched-more {
    color: #9a8aaa;
  }
  .loading {
    color: #9a8aaa;
  }
  .empty-state {
    color: #9a8aaa;
  }
  .task-person {
    color: #9a8aaa;
  }
  .delete-btn {
    color: #9a8aaa;
  }
  .project-note {
    color: #9a8aaa;
  }
  .project-person-tag {
    color: #9a8aaa;
    background: rgba(180, 160, 200, 0.08);
    border-color: rgba(160, 120, 180, 0.2);
  }
  .checkbox {
    border-color: rgba(160, 120, 180, 0.3);
    background: rgba(180, 160, 200, 0.05);
  }
  .checkbox.checked {
    background: #5eaba5;
    border-color: #5eaba5;
  }
  .add-btn {
    border-color: rgba(160, 120, 180, 0.3);
    background: rgba(180, 160, 200, 0.08);
    color: #c8a0d4;
  }
  .add-btn:hover {
    background: #8a6a9e;
    border-color: #8a6a9e;
    color: #fff;
  }
  .ptog {
    border-color: rgba(160, 120, 180, 0.3);
    background: rgba(180, 160, 200, 0.08);
    color: #9a8aaa;
  }
  .ptog.active {
    background: #5eaba5;
    border-color: #5eaba5;
    color: #120d1a;
  }
  .save-btn {
    background: #5eaba5;
    color: #120d1a;
  }
  .save-btn:hover {
    background: #7cc5c0;
  }
  .add-form {
    background: rgba(180, 160, 200, 0.05);
    border-color: rgba(160, 120, 180, 0.2);
  }
  .text-input {
    background: rgba(18, 13, 26, 0.6);
    border-color: rgba(160, 120, 180, 0.2);
    color: #e0dce4;
  }
  .text-input:focus {
    border-color: #8a6a9e;
  }
  .text-input::placeholder {
    color: #9a8aaa;
  }
  .time-input {
    background: rgba(18, 13, 26, 0.6);
    border-color: rgba(160, 120, 180, 0.2);
    color: #e0dce4;
  }
  .time-input:focus {
    border-color: #8a6a9e;
  }
  .schedule-item {
    border-bottom-color: rgba(160, 120, 180, 0.1);
  }
  .schedule-time {
    color: #c8a0d4;
  }
  .project-item {
    border-bottom-color: rgba(160, 120, 180, 0.1);
  }
  .archive-btn {
    color: #5eaba5;
  }

  /* Mobile adjustments */
  @media (max-width: 480px) {
    .delete-btn, .project-actions {
      opacity: 1;
    }
  }
</style>
