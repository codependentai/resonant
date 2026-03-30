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

  let { embedded = false } = $props<{ embedded?: boolean }>();

  let canvases = $derived(getCanvases());
  let activeCanvasId = $derived(getActiveCanvasId());
  let canvas = $derived(canvases.find(c => c.id === activeCanvasId) ?? null);

  // Local editing state
  let localContent = $state('');
  let localTitle = $state('');
  let editMode = $state(true);
  let isDirty = $state(false);
  let prevCanvasId = $state<string | null>(null);
  let saveTimeout: ReturnType<typeof setTimeout> | null = null;

  // Sync local state when canvas changes (only when not dirty)
  $effect(() => {
    if (canvas && !isDirty) {
      localContent = canvas.content;
      localTitle = canvas.title;
    }
  });

  // Reset local state when switching to a different canvas
  $effect(() => {
    if (activeCanvasId !== prevCanvasId) {
      prevCanvasId = activeCanvasId;
      isDirty = false;
      editMode = true;
      if (canvas) {
        localContent = canvas.content;
        localTitle = canvas.title;
      }
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
  <div class="canvas-panel" class:embedded>
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
        <div class="canvas-preview">
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
          bind:value={localContent}
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
    background: var(--bg-surface);
    border-left: 1px solid var(--border);
    position: relative;
    flex-shrink: 0;
  }

  .canvas-panel.embedded {
    width: 100%;
    min-width: 0;
    max-width: none;
    height: 100%;
    border-left: none;
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    overflow: hidden;
    background:
      radial-gradient(circle at top left, rgba(94, 171, 165, 0.08), transparent 30%),
      linear-gradient(180deg, var(--bg-hover), transparent 18%),
      var(--bg-secondary);
    box-shadow: inset 0 1px 0 var(--border);
  }

  .canvas-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.9rem 1rem 0.85rem;
    border-bottom: 1px solid var(--border);
    gap: 0.75rem;
    flex-shrink: 0;
    background: linear-gradient(180deg, var(--bg-hover), transparent);
    backdrop-filter: blur(16px);
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
    color: var(--text-primary);
    font-family: var(--font-heading);
    font-size: 1.02rem;
    font-weight: 600;
    letter-spacing: 0.01em;
    padding: 0.1rem 0;
    flex: 1;
    min-width: 0;
    outline: none;
    border-bottom: 1px solid transparent;
    transition: border-color var(--transition);
  }

  .canvas-title-input:focus {
    border-bottom-color: var(--border-hover);
  }

  .canvas-badge {
    font-size: 0.6875rem;
    padding: 0.22rem 0.55rem;
    border-radius: 1rem;
    background: rgba(94, 171, 165, 0.12);
    color: var(--accent);
    white-space: nowrap;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 600;
  }

  .canvas-header-actions {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    flex-shrink: 0;
    padding: 0.2rem;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--bg-hover);
  }

  .canvas-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.15rem;
    height: 2.15rem;
    border-radius: 0.8rem;
    color: var(--text-muted);
    border: 1px solid transparent;
    transition: all var(--transition);
  }

  .canvas-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
    border-color: var(--border-hover);
  }

  .canvas-btn-danger:hover {
    color: var(--error, #ef4444);
  }

  .canvas-body {
    flex: 1;
    overflow: hidden;
    display: flex;
    min-height: 0;
  }

  .canvas-editor {
    flex: 1;
    background: transparent;
    color: var(--text-primary);
    border: none;
    padding: 1.1rem 1.1rem 1.25rem;
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
    padding: 1.1rem 1.1rem 1.25rem;
    overflow-y: auto;
    color: var(--text-primary);
    font-size: 0.9375rem;
    line-height: 1.6;
  }

  .canvas-preview :global(p) { margin: 0.5rem 0; }
  .canvas-preview :global(p:first-child) { margin-top: 0; }
  .canvas-preview :global(p:last-child) { margin-bottom: 0; }

  .canvas-preview :global(code) {
    background: var(--bg-tertiary);
    padding: 0.125rem 0.25rem;
    border-radius: 0.25rem;
    font-family: var(--font-mono);
    font-size: 0.875em;
  }

  .canvas-preview :global(pre) {
    background: var(--bg-tertiary);
    padding: 0.75rem;
    border-radius: var(--radius-sm);
    overflow-x: auto;
    margin: 0.5rem 0;
  }

  .canvas-preview :global(pre code) { background: none; padding: 0; }

  .canvas-preview :global(a) {
    color: var(--gold);
    text-decoration: underline;
    text-decoration-color: var(--gold-dim);
  }

  .canvas-preview :global(strong) { font-weight: 600; }
  .canvas-preview :global(em) { font-style: italic; }

  .canvas-preview :global(ul),
  .canvas-preview :global(ol) {
    margin: 0.5rem 0;
    padding-left: 1.5rem;
  }

  .canvas-preview :global(blockquote) {
    border-left: 2px solid var(--gold-dim);
    padding-left: 1rem;
    margin: 0.5rem 0;
    color: var(--text-secondary);
  }

  .canvas-preview :global(h1),
  .canvas-preview :global(h2),
  .canvas-preview :global(h3) {
    color: var(--gold);
    font-family: var(--font-heading);
    margin: 1rem 0 0.5rem;
  }

  .canvas-preview :global(h1) { font-size: 1.5rem; }
  .canvas-preview :global(h2) { font-size: 1.25rem; }
  .canvas-preview :global(h3) { font-size: 1.1rem; }

  .canvas-preview :global(hr) {
    border: none;
    border-top: 1px solid var(--border);
    margin: 1rem 0;
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

    .canvas-panel.embedded {
      border: none;
      border-radius: 0;
      box-shadow: none;
      background:
        radial-gradient(circle at top left, rgba(94, 171, 165, 0.1), transparent 32%),
        linear-gradient(180deg, var(--bg-hover), transparent 18%),
        var(--bg-primary);
    }

    .canvas-header {
      align-items: flex-start;
      padding: 0.75rem 0.8rem 0.7rem;
      gap: 0.7rem;
    }

    .canvas-panel.embedded .canvas-header {
      padding-top: calc(env(safe-area-inset-top, 0px) + 0.8rem);
    }

    .canvas-header-left {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.45rem;
    }

    .canvas-title-input {
      font-size: 1rem;
      width: 100%;
    }

    .canvas-editor {
      padding: 0.95rem 0.85rem calc(env(safe-area-inset-bottom, 0px) + 1.2rem);
      font-size: 1rem;
    }

    .canvas-preview {
      padding: 0.95rem 0.85rem calc(env(safe-area-inset-bottom, 0px) + 1.2rem);
    }

    .canvas-header-actions {
      gap: 0.2rem;
      padding: 0.18rem;
    }

    .canvas-btn {
      width: 2.25rem;
      height: 2.25rem;
      border-radius: 0.85rem;
    }

    .canvas-save-indicator {
      bottom: calc(env(safe-area-inset-bottom, 0px) + 0.5rem);
    }
  }

  @keyframes canvasSlideIn {
    from { transform: translateX(100%); }
    to { transform: translateX(0); }
  }
</style>
