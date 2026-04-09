<script lang="ts">
  import { onMount } from 'svelte';
  import '../../../resonant.css';
  import CcPageHeader from '$lib/components/CcPageHeader.svelte';
  import ResCheckbox from '$lib/components/ResCheckbox.svelte';
  import ResEmpty from '$lib/components/ResEmpty.svelte';
  import ResSkeleton from '$lib/components/ResSkeleton.svelte';
  import { CC_API, todayStr, isToday, dayLabel } from '$lib/utils/cc';

  interface Task {
    id: string; text: string; project_id: string | null; project_name: string | null;
    date: string | null; due_date: string | null; person: string; priority: number;
    status: string; sort_order: number; completed_at: string | null;
  }

  interface Project { id: string; name: string; color: string | null; active_tasks: number; deadline: string | null; description: string | null; }
  interface ValeEvent { id: string; title: string; start_time: string | null; category: string; }

  let selectedDate = $state(todayStr());
  let allTasks = $state<Task[]>([]);
  let projects = $state<Project[]>([]);
  let events = $state<ValeEvent[]>([]);
  let weekDates = $state<string[]>([]);
  let loading = $state(true);
  let collapsed = $state<Set<string>>(new Set());

  // Inline add
  let addingToProject = $state<string | null>(null);
  let newTaskText = $state('');
  let newTaskPriority = $state(0);

  // Inline edit
  let editingTask = $state<string | null>(null);
  let editText = $state('');

  // Project edit
  let editingProject = $state<string | null>(null);
  let projName = $state(''); let projColor = $state(''); let projDeadline = $state('');
  let showNewProject = $state(false);

  // Drag state
  let dragId = $state<string | null>(null);
  let dragOverId = $state<string | null>(null);

  // Grouped tasks
  let grouped = $derived.by(() => {
    const groups = new Map<string, { project: Project | null; tasks: Task[] }>();
    for (const t of allTasks) {
      const key = t.project_name || '__ungrouped__';
      if (!groups.has(key)) {
        const proj = projects.find(p => p.name === t.project_name) || null;
        groups.set(key, { project: proj, tasks: [] });
      }
      groups.get(key)!.tasks.push(t);
    }
    // Sort tasks within each group by sort_order
    for (const g of groups.values()) {
      g.tasks.sort((a, b) => a.sort_order - b.sort_order);
    }
    // Projects first (alphabetical), ungrouped last
    const sorted = [...groups.entries()].sort((a, b) => {
      if (a[0] === '__ungrouped__') return 1;
      if (b[0] === '__ungrouped__') return -1;
      return a[0].localeCompare(b[0]);
    });
    return sorted;
  });

  function computeWeek(dateStr: string): string[] {
    const d = new Date(dateStr);
    const day = d.getDay();
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((day + 6) % 7));
    return Array.from({ length: 7 }, (_, i) => {
      const dd = new Date(monday);
      dd.setDate(monday.getDate() + i);
      return dd.toISOString().split('T')[0];
    });
  }

  async function loadDay(date: string) {
    loading = true;
    try {
      const [taskRes, eventRes, projRes] = await Promise.all([
        fetch(`${CC_API}/tasks?status=active`),
        fetch(`${CC_API}/events?start_date=${date}&end_date=${date}`),
        fetch(`${CC_API}/projects?status=active`),
      ]);
      const [taskData, eventData, projData] = await Promise.all([taskRes.json(), eventRes.json(), projRes.json()]);
      allTasks = taskData.tasks || []; events = eventData.events || []; projects = projData.projects || [];
    } catch { /* empty states handle */ }
    loading = false;
  }

  async function addTask(projectName: string | null) {
    if (!newTaskText.trim()) return;
    await fetch(`${CC_API}/tasks`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: newTaskText.trim(), project: projectName || undefined, priority: newTaskPriority }),
    });
    newTaskText = ''; newTaskPriority = 0; addingToProject = null;
    await loadDay(selectedDate);
  }

  async function toggleComplete(task: Task) {
    if (task.status === 'active') {
      await fetch(`${CC_API}/tasks/${task.id}/complete`, { method: 'PUT' });
    } else {
      await fetch(`${CC_API}/tasks/${task.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'active' }) });
    }
    await loadDay(selectedDate);
  }

  async function saveTaskEdit() {
    if (!editingTask || !editText.trim()) return;
    await fetch(`${CC_API}/tasks/${editingTask}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: editText.trim() }) });
    editingTask = null; editText = '';
    await loadDay(selectedDate);
  }

  async function cyclePriority(task: Task) {
    const next = task.priority >= 2 ? 0 : task.priority + 1;
    await fetch(`${CC_API}/tasks/${task.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ priority: next }) });
    await loadDay(selectedDate);
  }

  async function deleteTask(id: string) {
    await fetch(`${CC_API}/tasks/${id}`, { method: 'DELETE' });
    await loadDay(selectedDate);
  }

  // Project CRUD
  async function saveProjectEdit() {
    if (!editingProject || !projName.trim()) return;
    await fetch(`${CC_API}/projects/${editingProject}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: projName.trim(), color: projColor || undefined, deadline: projDeadline || undefined }) });
    editingProject = null;
    await loadDay(selectedDate);
  }

  async function createProject() {
    if (!projName.trim()) return;
    await fetch(`${CC_API}/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: projName.trim(), color: projColor || undefined, deadline: projDeadline || undefined }) });
    projName = ''; projColor = ''; projDeadline = ''; showNewProject = false;
    await loadDay(selectedDate);
  }

  function startProjectEdit(project: Project) {
    editingProject = project.id; projName = project.name; projColor = project.color || ''; projDeadline = project.deadline || '';
  }

  function toggleCollapse(key: string) {
    const next = new Set(collapsed);
    next.has(key) ? next.delete(key) : next.add(key);
    collapsed = next;
  }

  // Drag and drop
  function onDragStart(e: DragEvent, taskId: string) {
    dragId = taskId;
    if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', taskId); }
  }

  function onDragOver(e: DragEvent, taskId: string) {
    e.preventDefault();
    dragOverId = taskId;
  }

  async function onDrop(e: DragEvent, targetId: string, projectTasks: Task[]) {
    e.preventDefault();
    if (!dragId || dragId === targetId) { dragId = null; dragOverId = null; return; }
    const fromIdx = projectTasks.findIndex(t => t.id === dragId);
    const toIdx = projectTasks.findIndex(t => t.id === targetId);
    if (fromIdx < 0 || toIdx < 0) { dragId = null; dragOverId = null; return; }

    // Reorder locally
    const items = [...projectTasks];
    const [moved] = items.splice(fromIdx, 1);
    items.splice(toIdx, 0, moved);

    // Update sort_order for all affected
    const updates = items.map((t, i) => fetch(`${CC_API}/tasks/${t.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sort_order: i }),
    }));
    await Promise.all(updates);
    dragId = null; dragOverId = null;
    await loadDay(selectedDate);
  }

  function selectDate(date: string) { selectedDate = date; loadDay(date); }
  function prevWeek() { const d = new Date(weekDates[0]); d.setDate(d.getDate() - 7); weekDates = computeWeek(d.toISOString().split('T')[0]); selectDate(weekDates[0]); }
  function nextWeek() { const d = new Date(weekDates[0]); d.setDate(d.getDate() + 7); weekDates = computeWeek(d.toISOString().split('T')[0]); selectDate(weekDates[0]); }

  function priorityLabel(p: number): string { return p >= 2 ? '!!' : p >= 1 ? '!' : ''; }

  onMount(() => { weekDates = computeWeek(selectedDate); loadDay(selectedDate); });
</script>

<main class="res-page">
  <CcPageHeader title="Planner" />

  <!-- Week bar -->
  <div class="week-bar">
    <button class="res-btn res-btn--icon week-nav" onclick={prevWeek} aria-label="Previous week">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
    </button>
    <div class="week-days">
      {#each weekDates as date}
        <button class="day-btn" class:selected={date === selectedDate} class:today={isToday(date)} onclick={() => selectDate(date)}>
          <span class="day-name">{dayLabel(date).name}</span>
          <span class="day-num">{dayLabel(date).num}</span>
        </button>
      {/each}
    </div>
    <button class="res-btn res-btn--icon week-nav" onclick={nextWeek} aria-label="Next week">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
    </button>
  </div>

  <div class="res-content">
    {#if loading}
      <ResSkeleton variant="list" rows={8} />
    {:else}
      <!-- Events for selected day -->
      {#if events.length > 0}
        <div class="res-card res-card--accent">
          <span class="res-section-title">Schedule</span>
          {#each events as event}
            <div class="event-line">
              <span class="event-time">{event.start_time || 'All day'}</span>
              <span class="res-truncate">{event.title}</span>
              <span class="event-cat">{event.category}</span>
            </div>
          {/each}
        </div>
      {/if}

      <!-- Task groups -->
      {#if allTasks.length === 0 && projects.length === 0}
        <ResEmpty message="No tasks yet" actionLabel="Add a task" onaction={() => { addingToProject = '__ungrouped__'; }} />
      {:else}
        {#each grouped as [key, group]}
          <div class="project-group">
            <!-- Project header -->
            <div class="group-header">
              {#if key === '__ungrouped__'}
                <span class="group-title">Ungrouped</span>
              {:else}
                <div class="group-title-row">
                  {#if group.project?.color}
                    <span class="project-dot" style:background={group.project.color}></span>
                  {/if}
                  <span class="group-title">{key}</span>
                  {#if group.project?.deadline}
                    <span class="group-deadline">due {group.project.deadline}</span>
                  {/if}
                </div>
                <div class="group-actions">
                  <button class="group-action" onclick={() => startProjectEdit(group.project!)} aria-label="Edit project">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  </button>
                  <button class="group-action" onclick={() => toggleCollapse(key)} aria-label={collapsed.has(key) ? 'Expand' : 'Collapse'}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style:transform={collapsed.has(key) ? 'rotate(-90deg)' : ''}>
                      <path d="M6 9l6 6 6-6"/></svg>
                  </button>
                </div>
              {/if}
            </div>

            <!-- Project edit form -->
            {#if editingProject === group.project?.id}
              <form class="res-form" style="margin: var(--space-2) 0;" onsubmit={(e) => { e.preventDefault(); saveProjectEdit(); }}>
                <div class="res-form-row">
                  <input type="text" bind:value={projName} placeholder="Project name" class="res-input" />
                  <input type="color" bind:value={projColor} class="color-picker" />
                </div>
                <div class="res-form-row">
                  <input type="date" bind:value={projDeadline} class="res-input" placeholder="Deadline" />
                  <button type="submit" class="res-btn res-btn--primary">Save</button>
                  <button type="button" class="res-btn res-btn--ghost" onclick={() => editingProject = null}>Cancel</button>
                </div>
              </form>
            {/if}

            <!-- Tasks (collapsible) -->
            {#if !collapsed.has(key)}
              <div class="task-list">
                {#each group.tasks as task (task.id)}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <div
                    class="task-row"
                    class:drag-over={dragOverId === task.id}
                    draggable="true"
                    ondragstart={(e) => onDragStart(e, task.id)}
                    ondragover={(e) => onDragOver(e, task.id)}
                    ondrop={(e) => onDrop(e, task.id, group.tasks)}
                    ondragend={() => { dragId = null; dragOverId = null; }}
                  >
                    <span class="drag-handle" aria-hidden="true">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="2"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="9" cy="18" r="2"/><circle cx="15" cy="18" r="2"/></svg>
                    </span>

                    <ResCheckbox checked={task.status === 'completed'} onchange={() => toggleComplete(task)} />

                    <div class="task-content">
                      {#if editingTask === task.id}
                        <form class="inline-edit" onsubmit={(e) => { e.preventDefault(); saveTaskEdit(); }}>
                          <input type="text" bind:value={editText} class="res-input" style="height: 36px;" onkeydown={(e) => { if (e.key === 'Escape') editingTask = null; }} />
                        </form>
                      {:else}
                        <button class="task-text-btn" class:done={task.status === 'completed'} onclick={() => { editingTask = task.id; editText = task.text; }}>
                          {task.text}
                        </button>
                      {/if}
                      {#if task.due_date}
                        <span class="task-due" class:overdue={task.due_date < todayStr()}>due {task.due_date}</span>
                      {/if}
                    </div>

                    <button
                      class="priority-btn"
                      class:high={task.priority === 1}
                      class:urgent={task.priority >= 2}
                      onclick={() => cyclePriority(task)}
                      aria-label="Cycle priority"
                    >{priorityLabel(task.priority) || '\u00B7'}</button>

                    <button class="task-del" onclick={() => deleteTask(task.id)} aria-label="Delete task">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </div>
                {/each}
              </div>

              <!-- Inline add task -->
              {#if addingToProject === key}
                <form class="inline-add" onsubmit={(e) => { e.preventDefault(); addTask(key === '__ungrouped__' ? null : key); }}>
                  <input type="text" bind:value={newTaskText} placeholder="New task..." class="res-input" style="height: 40px;" />
                  <select bind:value={newTaskPriority} class="res-select" style="max-width: 6rem;">
                    <option value={0}>Normal</option>
                    <option value={1}>High</option>
                    <option value={2}>Urgent</option>
                  </select>
                  <button type="submit" class="res-btn res-btn--primary" style="padding: 0 var(--space-3);">Add</button>
                </form>
              {:else}
                <button class="add-task-btn" onclick={() => { addingToProject = key; newTaskText = ''; }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  Add task
                </button>
              {/if}
            {/if}
          </div>
        {/each}
      {/if}

      <!-- New project -->
      {#if showNewProject}
        <form class="res-form" onsubmit={(e) => { e.preventDefault(); createProject(); }}>
          <div class="res-form-row">
            <input type="text" bind:value={projName} placeholder="Project name" class="res-input" />
            <input type="color" bind:value={projColor} class="color-picker" />
          </div>
          <div class="res-form-row">
            <input type="date" bind:value={projDeadline} class="res-input" placeholder="Deadline" />
            <button type="submit" class="res-btn res-btn--primary">Create</button>
            <button type="button" class="res-btn res-btn--ghost" onclick={() => showNewProject = false}>Cancel</button>
          </div>
        </form>
      {:else}
        <button class="add-project-btn" onclick={() => { showNewProject = true; projName = ''; projColor = ''; projDeadline = ''; }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New Project
        </button>
      {/if}
    {/if}
  </div>
</main>

<style>
  .week-bar { display: flex; align-items: center; padding: var(--space-2); border-bottom: 1px solid var(--border); gap: var(--space-1); }
  .week-nav { flex-shrink: 0; }
  .week-days { display: flex; flex: 1; justify-content: space-around; gap: var(--space-1); }
  .day-btn {
    display: flex; flex-direction: column; align-items: center; gap: 2px;
    min-width: 44px; min-height: 52px; padding: var(--space-2);
    border: 1px solid transparent; border-radius: 10px; background: none;
    color: var(--text-secondary); cursor: pointer; transition: all var(--transition);
    -webkit-tap-highlight-color: transparent;
  }
  .day-btn:hover { background: var(--bg-hover); }
  .day-btn:active { transform: scale(0.95); }
  .day-btn.selected { background: var(--bg-surface); border-color: var(--accent); color: var(--text-primary); }
  .day-btn.today .day-num { color: var(--accent); font-weight: 700; }
  .day-name { font-size: var(--text-xs); text-transform: uppercase; }
  .day-num { font-size: var(--text-base); font-weight: 500; }

  .event-line { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) 0; font-size: var(--text-base); }
  .event-time { font-size: var(--text-sm); color: var(--text-muted); min-width: 4rem; flex-shrink: 0; }
  .event-cat { font-size: var(--text-xs); color: var(--text-muted); flex-shrink: 0; }

  /* Project groups */
  .project-group {
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    background: var(--bg-secondary);
  }

  .group-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--border);
    min-height: 44px;
  }

  .group-title-row { display: flex; align-items: center; gap: var(--space-2); }
  .group-title { font-size: var(--text-base); font-weight: 600; }
  .group-deadline { font-size: var(--text-xs); color: var(--text-muted); }
  .project-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }

  .group-actions { display: flex; gap: var(--space-1); }
  .group-action {
    width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;
    background: none; border: none; color: var(--text-muted); cursor: pointer;
    border-radius: 8px; transition: all var(--transition);
  }
  .group-action:hover { color: var(--text-primary); background: var(--bg-hover); }

  /* Task list */
  .task-list { display: flex; flex-direction: column; }

  .task-row {
    display: flex; align-items: center; gap: var(--space-1);
    padding: var(--space-1) var(--space-3);
    border-bottom: 1px solid var(--border);
    min-height: 44px;
    transition: background var(--transition-fast);
  }
  .task-row:last-child { border-bottom: none; }
  .task-row:hover { background: var(--bg-hover); }
  .task-row.drag-over { background: var(--gold-ember); border-top: 2px solid var(--accent); }

  .drag-handle {
    cursor: grab; color: var(--text-muted); opacity: 0.3;
    padding: var(--space-1); flex-shrink: 0; display: flex;
    transition: opacity var(--transition);
  }
  .task-row:hover .drag-handle { opacity: 0.8; }
  .drag-handle:active { cursor: grabbing; }

  .task-content { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }

  .task-text-btn {
    background: none; border: none; color: var(--text-primary);
    font-size: var(--text-base); text-align: left; cursor: text;
    padding: 0; font-family: var(--font-body); line-height: 1.4;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .task-text-btn.done { text-decoration: line-through; opacity: 0.5; }
  .task-text-btn:hover { color: var(--accent); }

  .inline-edit { display: flex; }
  .inline-edit .res-input { font-size: var(--text-base); }

  .task-due { font-size: var(--text-xs); color: var(--text-muted); }
  .task-due.overdue { color: var(--color-error); font-weight: 600; }

  .priority-btn {
    width: 28px; height: 28px; border-radius: 6px; background: none;
    border: none; color: var(--text-muted); cursor: pointer;
    font-weight: 700; font-size: var(--text-sm); flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    transition: all var(--transition);
  }
  .priority-btn.high { color: var(--color-warning); }
  .priority-btn.urgent { color: var(--color-error); }
  .priority-btn:hover { background: var(--bg-hover); }

  .task-del {
    width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;
    background: none; border: none; color: var(--text-muted); cursor: pointer;
    opacity: 0; transition: opacity var(--transition); flex-shrink: 0; border-radius: 6px;
  }
  .task-row:hover .task-del { opacity: 1; }
  .task-del:hover { color: var(--color-danger); background: var(--bg-hover); }

  /* Inline add */
  .inline-add {
    display: flex; gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
  }

  .add-task-btn {
    display: flex; align-items: center; gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    color: var(--text-muted); font-size: var(--text-sm);
    background: none; border: none; cursor: pointer;
    transition: color var(--transition); min-height: 40px;
  }
  .add-task-btn:hover { color: var(--accent); }

  .add-project-btn {
    display: flex; align-items: center; gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    color: var(--text-muted); font-size: var(--text-sm);
    background: none; border: 1px dashed var(--border);
    border-radius: var(--radius-card); cursor: pointer;
    transition: all var(--transition); min-height: 44px; width: 100%;
  }
  .add-project-btn:hover { color: var(--accent); border-color: var(--accent-muted); }

  .color-picker {
    width: 44px; height: 44px; border: 1px solid var(--border);
    border-radius: 10px; cursor: pointer; background: var(--bg-input);
    padding: 2px; flex-shrink: 0;
  }
</style>
