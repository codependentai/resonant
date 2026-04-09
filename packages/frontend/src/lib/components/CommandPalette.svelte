<script lang="ts">
  import type { CommandRegistryEntry } from '@resonant/shared';

  let {
    filter = '',
    commands = [],
    onselect,
    onclose,
  } = $props<{
    filter: string;
    commands: CommandRegistryEntry[];
    onselect: (command: CommandRegistryEntry) => void;
    onclose: () => void;
  }>();

  let selectedIndex = $state(0);
  let listEl = $state<HTMLDivElement | undefined>();

  // Group and filter commands
  let grouped = $derived.by(() => {
    const lower = filter.toLowerCase();
    const filtered = commands.filter((c: CommandRegistryEntry) =>
      c.name.toLowerCase().includes(lower) ||
      c.description.toLowerCase().includes(lower)
    );

    const builtin = filtered.filter((c: CommandRegistryEntry) => c.category === 'builtin');
    const skill = filtered.filter((c: CommandRegistryEntry) => c.category === 'skill');
    const custom = filtered.filter((c: CommandRegistryEntry) => c.category === 'custom');

    // Build flat list with group headers for keyboard nav
    const items: Array<{ type: 'header'; label: string } | { type: 'command'; command: CommandRegistryEntry }> = [];

    if (builtin.length > 0) {
      items.push({ type: 'header', label: 'Commands' });
      for (const c of builtin) items.push({ type: 'command', command: c });
    }
    if (skill.length > 0) {
      items.push({ type: 'header', label: 'Skills' });
      for (const c of skill) items.push({ type: 'command', command: c });
    }
    if (custom.length > 0) {
      items.push({ type: 'header', label: 'Custom' });
      for (const c of custom) items.push({ type: 'command', command: c });
    }

    return items;
  });

  // Only command items (skip headers) for keyboard nav
  let selectableItems = $derived(
    grouped.filter((item): item is { type: 'command'; command: CommandRegistryEntry } => item.type === 'command')
  );

  // Reset index when filter changes
  $effect(() => {
    filter;
    selectedIndex = 0;
  });

  // Scroll selected item into view
  $effect(() => {
    if (listEl && selectableItems.length > 0) {
      const el = listEl.querySelector(`[data-index="${selectedIndex}"]`);
      if (el) el.scrollIntoView({ block: 'nearest' });
    }
  });

  export function handleKey(e: KeyboardEvent): boolean {
    if (selectableItems.length === 0) return false;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        selectedIndex = (selectedIndex + 1) % selectableItems.length;
        return true;
      case 'ArrowUp':
        e.preventDefault();
        selectedIndex = (selectedIndex - 1 + selectableItems.length) % selectableItems.length;
        return true;
      case 'Tab':
      case 'Enter':
        e.preventDefault();
        if (selectableItems[selectedIndex]) {
          onselect(selectableItems[selectedIndex].command);
        }
        return true;
      case 'Escape':
        e.preventDefault();
        onclose();
        return true;
      default:
        return false;
    }
  }

  function categoryIcon(category: string): string {
    switch (category) {
      case 'builtin': return '';
      case 'skill': return '';
      case 'custom': return '';
      default: return '';
    }
  }

  let selectableIndex = 0;
</script>

{#if grouped.length > 0}
  <div class="command-palette" bind:this={listEl}>
    {#each grouped as item}
      {#if item.type === 'header'}
        <div class="palette-header">{item.label}</div>
      {:else}
        {@const cmdIndex = selectableItems.indexOf(item)}
        <button
          class="palette-item"
          class:selected={cmdIndex === selectedIndex}
          data-index={cmdIndex}
          onclick={() => onselect(item.command)}
          onmouseenter={() => { selectedIndex = cmdIndex; }}
        >
          <span class="palette-icon">{categoryIcon(item.command.category)}</span>
          <span class="palette-name">/{item.command.name}</span>
          {#if item.command.args}
            <span class="palette-args">{item.command.args}</span>
          {/if}
          <span class="palette-desc">{item.command.description}</span>
        </button>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .command-palette {
    position: absolute;
    bottom: calc(100% + 0.375rem);
    left: 0;
    right: 0;
    max-height: min(60vh, 24rem);
    overflow-y: auto;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.375rem;
    z-index: 50;
    animation: dropUp 150ms ease;
    box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.3);
  }

  @keyframes dropUp {
    from { opacity: 0; transform: translateY(0.25rem); }
    to { opacity: 1; transform: translateY(0); }
  }

  .palette-header {
    padding: 0.375rem 0.625rem 0.25rem;
    font-size: 0.6875rem;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-family: var(--font-heading);
  }

  .palette-header:not(:first-child) {
    margin-top: 0.25rem;
    border-top: 1px solid var(--border);
    padding-top: 0.5rem;
  }

  .palette-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.5rem 0.625rem;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background var(--transition-fast);
    text-align: left;
    background: transparent;
    border: none;
    color: var(--text-primary);
    font-size: 0.875rem;
  }

  .palette-item:hover,
  .palette-item.selected {
    background: var(--gold-glow, rgba(94, 171, 165, 0.1));
  }

  .palette-icon {
    flex-shrink: 0;
    width: 1.25rem;
    text-align: center;
    font-size: 0.875rem;
  }

  .palette-name {
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-weight: 500;
    color: var(--gold);
    font-size: 0.8125rem;
  }

  .palette-args {
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .palette-desc {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-secondary);
    font-size: 0.8125rem;
  }

  /* Scrollbar */
  .command-palette::-webkit-scrollbar { width: 4px; }
  .command-palette::-webkit-scrollbar-track { background: transparent; }
  .command-palette::-webkit-scrollbar-thumb {
    background: var(--border);
    border-radius: 2px;
  }
</style>
