<script lang="ts">
  import type { Canvas } from '@resonant/shared';
  import {
    getCanvases,
    getActiveCanvasId,
    setActiveCanvasId,
    sendCanvasCreate,
    sendCanvasDelete,
  } from '$lib/stores/websocket.svelte';

  let {
    onclose,
    embedded = false,
    stayOpenOnSelect = false,
  }: {
    onclose: () => void;
    embedded?: boolean;
    stayOpenOnSelect?: boolean;
  } = $props();

  let canvases = $derived(getCanvases());
  let activeCanvasId = $derived(getActiveCanvasId());

  // New canvas form
  let showNewForm = $state(false);
  let newTitle = $state('');
  let newType = $state<'markdown' | 'code' | 'text' | 'html'>('markdown');
  let newLanguage = $state('');

  function handleCreate() {
    const title = newTitle.trim() || 'Untitled';
    sendCanvasCreate(title, newType, newType === 'code' ? newLanguage || undefined : undefined);
    newTitle = '';
    newType = 'markdown';
    newLanguage = '';
    showNewForm = false;
  }

  function handleSelect(id: string) {
    setActiveCanvasId(id);
    if (!stayOpenOnSelect) onclose();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleCreate();
    } else if (e.key === 'Escape') {
      showNewForm = false;
    }
  }

  function formatTime(iso: string): string {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();

    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }
</script>

<div class="canvas-dropdown" class:embedded>
  <div class="canvas-dropdown-header">
    <span class="canvas-dropdown-title">Canvases</span>
    <button class="canvas-dropdown-close" onclick={onclose} aria-label="Close">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
  </div>

  {#if !showNewForm}
    <button class="canvas-new-btn" onclick={() => showNewForm = true}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="12" y1="5" x2="12" y2="19"/>
        <line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
      New Canvas
    </button>
  {:else}
    <div class="canvas-new-form">
      <!-- svelte-ignore a11y_autofocus -->
      <input
        type="text"
        class="canvas-new-input"
        bind:value={newTitle}
        onkeydown={handleKeydown}
        placeholder="Canvas title..."
        autofocus
      />
      <div class="canvas-new-options">
        <select class="canvas-new-select" bind:value={newType}>
          <option value="markdown">Markdown</option>
          <option value="code">Code</option>
          <option value="text">Text</option>
          <option value="html">HTML</option>
        </select>
        {#if newType === 'code'}
          <input
            type="text"
            class="canvas-new-input canvas-new-lang"
            bind:value={newLanguage}
            placeholder="Language"
          />
        {/if}
      </div>
      <div class="canvas-new-actions">
        <button class="canvas-action-btn" onclick={handleCreate}>Create</button>
        <button class="canvas-action-btn canvas-action-cancel" onclick={() => showNewForm = false}>Cancel</button>
      </div>
    </div>
  {/if}

  <div class="canvas-list">
    {#if canvases.length === 0}
      <div class="canvas-empty">No canvases yet</div>
    {:else}
      {#each canvases as c (c.id)}
        <button
          class="canvas-item"
          class:active={c.id === activeCanvasId}
          onclick={() => handleSelect(c.id)}
        >
          <div class="canvas-item-info">
            <span class="canvas-item-title">{c.title}</span>
            <span class="canvas-item-meta">
              <span class="canvas-item-type">{c.content_type}</span>
              <span class="canvas-item-time">{formatTime(c.updated_at)}</span>
            </span>
          </div>
        </button>
      {/each}
    {/if}
  </div>
</div>

<style>
  .canvas-dropdown {
    position: absolute;
    top: calc(100% + 0.25rem);
    right: 0;
    width: 280px;
    background: var(--bg-tertiary, var(--bg-secondary));
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    z-index: 50;
    display: flex;
    flex-direction: column;
    max-height: 400px;
    animation: dropdownFade 0.15s ease-out;
  }

  .canvas-dropdown.embedded {
    position: static;
    top: auto;
    right: auto;
    width: 100%;
    max-height: none;
    height: 100%;
    border: none;
    border-radius: 0;
    box-shadow: none;
    background: transparent;
    animation: none;
  }

  @keyframes dropdownFade {
    from { opacity: 0; transform: translateY(-0.25rem); }
    to { opacity: 1; transform: translateY(0); }
  }

  .canvas-dropdown-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.625rem 0.75rem;
    border-bottom: 1px solid var(--border);
  }

  .canvas-dropdown-title {
    font-family: var(--font-heading);
    font-size: 0.8125rem;
    color: var(--text-secondary);
    letter-spacing: 0;
    font-weight: 600;
  }

  .canvas-dropdown-close {
    color: var(--text-muted);
    padding: 0.25rem;
    border-radius: 0.25rem;
    transition: color var(--transition);
  }

  .canvas-dropdown-close:hover {
    color: var(--text-primary);
  }

  .canvas-new-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    color: var(--accent);
    font-size: 0.8125rem;
    font-weight: 500;
    border-bottom: 1px solid var(--border);
    transition: background var(--transition);
    width: 100%;
    text-align: left;
  }

  .canvas-new-btn:hover {
    background: var(--bg-hover);
  }

  .canvas-new-form {
    padding: 0.5rem 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    border-bottom: 1px solid var(--border);
  }

  .canvas-new-input {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    color: var(--text-primary);
    padding: 0.375rem 0.5rem;
    font-size: 0.8125rem;
    outline: none;
  }

  .canvas-new-input:focus {
    border-color: var(--border-hover);
  }

  .canvas-new-options {
    display: flex;
    gap: 0.375rem;
  }

  .canvas-new-select {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    color: var(--text-primary);
    padding: 0.25rem 0.375rem;
    font-size: 0.75rem;
    outline: none;
    flex: 1;
  }

  .canvas-new-lang {
    flex: 1;
    font-size: 0.75rem;
    padding: 0.25rem 0.375rem;
  }

  .canvas-new-actions {
    display: flex;
    gap: 0.375rem;
    justify-content: flex-end;
  }

  .canvas-action-btn {
    padding: 0.25rem 0.75rem;
    font-size: 0.75rem;
    border-radius: 0.375rem;
    background: var(--accent);
    color: var(--bg-primary);
    font-weight: 500;
    transition: opacity var(--transition);
  }

  .canvas-action-btn:hover {
    opacity: 0.9;
  }

  .canvas-action-cancel {
    background: transparent;
    color: var(--text-muted);
    border: 1px solid var(--border);
  }

  .canvas-action-cancel:hover {
    color: var(--text-primary);
  }

  .canvas-list {
    overflow-y: auto;
    flex: 1;
  }

  .canvas-empty {
    padding: 1.5rem;
    text-align: center;
    color: var(--text-muted);
    font-size: 0.8125rem;
  }

  .canvas-item {
    display: flex;
    width: 100%;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid var(--border);
    transition: background var(--transition);
    text-align: left;
  }

  .canvas-item:hover {
    background: var(--bg-hover);
  }

  .canvas-item.active {
    background: var(--bg-active);
    border-left: 2px solid var(--accent);
  }

  .canvas-item-info {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    min-width: 0;
  }

  .canvas-item-title {
    font-size: 0.8125rem;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .canvas-item-meta {
    display: flex;
    gap: 0.5rem;
    font-size: 0.6875rem;
    color: var(--text-muted);
  }

  .canvas-item-type {
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  @media (max-width: 768px) {
    .canvas-dropdown.embedded .canvas-dropdown-header {
      padding: calc(env(safe-area-inset-top, 0px) + 0.8rem) 0.85rem 0.75rem;
      border-bottom-color: var(--border);
      background: linear-gradient(180deg, var(--bg-hover), transparent);
      backdrop-filter: blur(16px);
    }

    .canvas-dropdown.embedded .canvas-new-btn,
    .canvas-dropdown.embedded .canvas-new-form {
      margin: 0 0.75rem;
      border-radius: 1rem;
      border: 1px solid var(--border);
      background: var(--bg-surface);
    }

    .canvas-dropdown.embedded .canvas-new-btn {
      margin-top: 0.75rem;
      border-bottom: 1px solid var(--border);
    }

    .canvas-dropdown.embedded .canvas-list {
      padding: 0.75rem 0.75rem calc(env(safe-area-inset-bottom, 0px) + 1rem);
    }

    .canvas-dropdown.embedded .canvas-item {
      border: 1px solid var(--border);
      border-radius: 0.95rem;
      margin-bottom: 0.55rem;
      background: var(--bg-surface);
    }

    .canvas-dropdown.embedded .canvas-item.active {
      border-left-width: 1px;
      box-shadow: inset 0 0 0 1px rgba(94, 171, 165, 0.28);
    }
  }
</style>
