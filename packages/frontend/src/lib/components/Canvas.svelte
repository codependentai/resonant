<script lang="ts">
  import type { Canvas as CanvasType } from '@resonant/shared';
  import {
    getCanvases,
    getActiveCanvasId,
    setActiveCanvasId,
    sendCanvasUpdate,
    sendCanvasUpdateTitle,
    sendCanvasDelete,
  } from '$lib/stores/websocket.svelte';
  import { renderMarkdown } from '$lib/utils/markdown';

  let canvases = $derived(getCanvases());
  let activeCanvasId = $derived(getActiveCanvasId());
  let canvas = $derived(canvases.find(c => c.id === activeCanvasId) ?? null);

  // Local editing state
  let localContent = $state('');
  let localTitle = $state('');
  let editMode = $state(true);
  let isDirty = $state(false);
  let saveTimeout: ReturnType<typeof setTimeout> | null = null;

  // Sync local state when canvas changes
  $effect(() => {
    if (canvas && !isDirty) {
      localContent = canvas.content;
      localTitle = canvas.title;
    }
  });

  // Reset local state when switching canvases
  $effect(() => {
    activeCanvasId; // track
    isDirty = false;
    editMode = true;
    if (canvas) {
      localContent = canvas.content;
      localTitle = canvas.title;
    }
  });

  function handleContentInput(e: Event) {
    const textarea = e.target as HTMLTextAreaElement;
    localContent = textarea.value;
    isDirty = true;

    // Debounced auto-save
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      if (activeCanvasId && isDirty) {
        sendCanvasUpdate(activeCanvasId, localContent);
        isDirty = false;
      }
    }, 500);
  }

  function handleTitleBlur() {
    if (activeCanvasId && localTitle !== canvas?.title) {
      sendCanvasUpdateTitle(activeCanvasId, localTitle);
    }
  }

  function handleTitleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      (e.target as HTMLInputElement).blur();
    }
  }

  function handleClose() {
    // Flush pending save
    if (saveTimeout) clearTimeout(saveTimeout);
    if (activeCanvasId && isDirty) {
      sendCanvasUpdate(activeCanvasId, localContent);
    }
    setActiveCanvasId(null);
  }

  function handleDelete() {
    if (!activeCanvasId || !canvas) return;
    if (!confirm(`Delete canvas "${canvas.title}"?`)) return;
    sendCanvasDelete(activeCanvasId);
  }

  function toggleMode() {
    // Flush save before switching to preview
    if (editMode && activeCanvasId && isDirty) {
      sendCanvasUpdate(activeCanvasId, localContent);
      isDirty = false;
    }
    editMode = !editMode;
  }

  let contentTypeBadge = $derived(
    canvas?.content_type === 'code'
      ? (canvas.language || 'code')
      : canvas?.content_type || 'markdown'
  );
</script>

{#if canvas}
  <div class="canvas-panel">
    <header class="canvas-header">
      <div class="canvas-header-left">
        <input
          type="text"
          class="canvas-title-input"
          bind:value={localTitle}
          onblur={handleTitleBlur}
          onkeydown={handleTitleKeydown}
          placeholder="Untitled"
        />
        <span class="canvas-badge">{contentTypeBadge}</span>
      </div>
      <div class="canvas-header-actions">
        {#if canvas.content_type === 'markdown' || canvas.content_type === 'html'}
          <button class="canvas-btn" onclick={toggleMode} title={editMode ? 'Preview' : 'Edit'}>
            {#if editMode}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            {:else}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            {/if}
          </button>
        {/if}
        <button class="canvas-btn canvas-btn-danger" onclick={handleDelete} title="Delete canvas">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
          </svg>
        </button>
        <button class="canvas-btn" onclick={handleClose} title="Close canvas">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    </header>

    <div class="canvas-body">
      {#if (canvas.content_type === 'markdown' || canvas.content_type === 'html') && !editMode}
        <div class="canvas-preview markdown-body">
          {#if canvas.content_type === 'html'}
            <iframe class="canvas-iframe" srcdoc={localContent} sandbox="allow-same-origin" title={canvas.title}></iframe>
          {:else}
            {@html renderMarkdown(localContent)}
          {/if}
        </div>
      {:else}
        <textarea
          class="canvas-editor"
          class:mono={canvas.content_type === 'code' || canvas.content_type === 'html'}
          value={localContent}
          oninput={handleContentInput}
          placeholder={canvas.content_type === 'code' ? 'Write code...' : canvas.content_type === 'html' ? 'Write HTML...' : 'Start writing...'}
          spellcheck={canvas.content_type !== 'code' && canvas.content_type !== 'html'}
        ></textarea>
      {/if}
    </div>

    {#if isDirty}
      <div class="canvas-save-indicator">Saving...</div>
    {/if}
  </div>
{/if}

<style>
  .canvas-panel {
    width: 450px;
    min-width: 350px;
    max-width: 50vw;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--bg-secondary);
    border-left: 1px solid var(--border);
    position: relative;
    flex-shrink: 0;
  }

  .canvas-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--border);
    gap: 0.5rem;
    flex-shrink: 0;
  }

  .canvas-header-left {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex: 1;
    min-width: 0;
  }

  .canvas-title-input {
    background: transparent;
    border: none;
    color: var(--gold);
    font-family: var(--font-heading);
    font-size: 1rem;
    font-weight: 400;
    letter-spacing: 0.04em;
    padding: 0.25rem 0;
    flex: 1;
    min-width: 0;
    outline: none;
    border-bottom: 1px solid transparent;
    transition: border-color var(--transition);
  }

  .canvas-title-input:focus {
    border-bottom-color: var(--gold-dim);
  }

  .canvas-badge {
    font-size: 0.6875rem;
    padding: 0.125rem 0.5rem;
    border-radius: 1rem;
    background: rgba(139, 92, 246, 0.15);
    color: var(--accent, #8b5cf6);
    white-space: nowrap;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 500;
  }

  .canvas-header-actions {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    flex-shrink: 0;
  }

  .canvas-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.375rem;
    border-radius: 0.375rem;
    color: var(--text-muted);
    transition: all var(--transition);
  }

  .canvas-btn:hover {
    color: var(--gold-dim);
    background: rgba(255, 255, 255, 0.05);
  }

  .canvas-btn-danger:hover {
    color: var(--error, #ef4444);
  }

  .canvas-body {
    flex: 1;
    overflow: hidden;
    display: flex;
  }

  .canvas-editor {
    flex: 1;
    background: transparent;
    color: var(--text-primary);
    border: none;
    padding: 1rem;
    font-family: var(--font-body);
    font-size: 0.9375rem;
    line-height: 1.6;
    resize: none;
    outline: none;
    overflow-y: auto;
  }

  .canvas-editor.mono {
    font-family: var(--font-mono, 'JetBrains Mono', 'Fira Code', monospace);
    font-size: 0.875rem;
    line-height: 1.5;
    tab-size: 2;
  }

  .canvas-preview {
    flex: 1;
    padding: 1rem;
    overflow-y: auto;
    color: var(--text-primary);
    font-size: 0.9375rem;
    line-height: 1.6;
  }

  .canvas-iframe {
    width: 100%;
    height: 100%;
    border: none;
    background: #fff;
    border-radius: 0.25rem;
  }

  .canvas-save-indicator {
    position: absolute;
    bottom: 0.5rem;
    right: 0.75rem;
    font-size: 0.6875rem;
    color: var(--text-muted);
    opacity: 0.6;
    pointer-events: none;
  }

  /* Mobile: full-screen overlay */
  @media (max-width: 768px) {
    .canvas-panel {
      position: fixed;
      inset: 0;
      width: 100%;
      max-width: 100%;
      min-width: unset;
      z-index: 200;
      animation: canvasSlideIn 0.25s ease-out;
      padding-top: env(safe-area-inset-top, 0px);
    }

    .canvas-header {
      padding: 0.5rem 0.75rem;
    }

    .canvas-title-input {
      font-size: 0.9375rem;
    }

    .canvas-editor {
      padding: 0.75rem;
      font-size: 1rem;
    }

    .canvas-preview {
      padding: 0.75rem;
    }

    .canvas-btn {
      padding: 0.5rem;
    }
  }

  @keyframes canvasSlideIn {
    from { transform: translateX(100%); }
    to { transform: translateX(0); }
  }
</style>
