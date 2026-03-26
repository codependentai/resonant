<script lang="ts">
  import type { Message, CommandRegistryEntry } from '@resonant/shared';
  import VoiceRecorder from './VoiceRecorder.svelte';
  import VoiceModeToggle from './VoiceModeToggle.svelte';
  import { getCompanionName } from '$lib/stores/settings.svelte';
  import CommandPalette from './CommandPalette.svelte';
  import { getCommandRegistry, sendCommand } from '$lib/stores/websocket.svelte';

  let companionName = $derived(getCompanionName());

  interface FileUploadResult {
    fileId: string;
    filename: string;
    mimeType: string;
    size: number;
    contentType: 'image' | 'audio' | 'file';
    url: string;
  }

  let {
    replyTo = null,
    isStreaming = false,
    activeThreadId = null,
    onbatchsend,
    oncancelreply,
    onstop,
  } = $props<{
    replyTo?: Message | null;
    isStreaming?: boolean;
    activeThreadId?: string | null;
    onbatchsend?: (text: string, files: FileUploadResult[], prosody?: Record<string, number>) => void;
    oncancelreply?: () => void;
    onstop?: () => void;
  }>();

  let textarea: HTMLTextAreaElement;
  let fileInput: HTMLInputElement;
  let content = $state('');
  let uploading = $state(false);
  let uploadError = $state<string | null>(null);
  let pendingAttachments = $state<FileUploadResult[]>([]);
  let pendingProsody = $state<Record<string, number> | null>(null);

  // Command palette state
  let showCommandPalette = $state(false);
  let commandFilter = $state('');
  let paletteRef: CommandPalette;
  let commandRegistry = $derived(getCommandRegistry());

  // Can send if there's text or pending attachments
  let canSend = $derived(content.trim().length > 0 || pendingAttachments.length > 0);

  // Auto-resize textarea
  function autoResize() {
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
    }
  }

  // Detect slash commands on input
  function handleInput() {
    autoResize();
    // Show command palette when content starts with / and is a single line
    if (content.startsWith('/') && !content.includes('\n')) {
      showCommandPalette = true;
      commandFilter = content.slice(1).split(' ')[0]; // filter on command name only
    } else {
      showCommandPalette = false;
      commandFilter = '';
    }
  }

  // Handle command selection from palette
  function handleCommandSelect(command: CommandRegistryEntry) {
    showCommandPalette = false;

    if (command.clientOnly) {
      executeClientCommand(command.name);
      resetInput();
      return;
    }

    if (command.args) {
      // Command takes arguments — fill prefix and let user type
      content = `/${command.name} `;
      textarea?.focus();
      return;
    }

    // No-arg server command — execute immediately
    sendCommand(command.name, undefined, activeThreadId ?? undefined);
    resetInput();
  }

  // Client-side command execution
  function executeClientCommand(name: string) {
    switch (name) {
      case 'help':
        // Show full palette with no filter
        showCommandPalette = true;
        commandFilter = '';
        content = '/';
        return; // Don't reset — keep palette open
      case 'stop':
        onstop?.();
        break;
    }
  }

  // Handle send — check for slash commands first
  function handleSend() {
    if (!canSend) return;

    const trimmed = content.trim();

    // Check if this is a slash command
    if (trimmed.startsWith('/')) {
      const spaceIndex = trimmed.indexOf(' ');
      const name = spaceIndex === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIndex);
      const args = spaceIndex === -1 ? undefined : trimmed.slice(spaceIndex + 1).trim() || undefined;

      const cmd = commandRegistry.find(c => c.name === name);
      if (cmd) {
        if (cmd.clientOnly) {
          executeClientCommand(name);
        } else {
          sendCommand(name, args, activeThreadId ?? undefined);
        }
        resetInput();
        return;
      }
      // Not a recognized command — fall through to send as regular message
    }

    const files = [...pendingAttachments];
    onbatchsend?.(trimmed, files, pendingProsody ?? undefined);
    resetInput();
  }

  function resetInput() {
    pendingAttachments = [];
    content = '';
    pendingProsody = null;
    showCommandPalette = false;
    commandFilter = '';
    if (textarea) textarea.style.height = 'auto';
  }

  // Remove a pending attachment
  function removeAttachment(index: number) {
    pendingAttachments = pendingAttachments.filter((_, i) => i !== index);
  }

  // Handle keyboard — route to palette when open
  function handleKeydown(e: KeyboardEvent) {
    if (showCommandPalette && paletteRef) {
      const handled = paletteRef.handleKey(e);
      if (handled) return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  // Upload a file to the server — queues as pending, doesn't send
  async function uploadFile(file: File) {
    uploading = true;
    uploadError = null;

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/files', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Upload failed' }));
        throw new Error(err.error || `Upload failed (${response.status})`);
      }

      const result: FileUploadResult = await response.json();
      pendingAttachments = [...pendingAttachments, result];
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      uploadError = msg;
      setTimeout(() => { uploadError = null; }, 5000);
    } finally {
      uploading = false;
    }
  }

  // Handle file input change — supports multiple files
  function handleFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = input.files;
    if (files) {
      for (const file of files) {
        uploadFile(file);
      }
    }
    input.value = '';
  }

  // Handle paste — detect images, queue as pending
  function handlePaste(e: ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) uploadFile(file);
        return;
      }
    }
  }

  // Handle voice transcript — populate textarea, hold prosody
  function handleTranscript(text: string, prosody?: Record<string, number> | null) {
    content = text;
    pendingProsody = prosody ?? null;
    textarea?.focus();
  }

  // Cancel reply
  function handleCancelReply() {
    oncancelreply?.();
  }

  // Watch content for auto-resize + discard prosody if textarea fully cleared
  $effect(() => {
    if (content === '' && pendingProsody) {
      pendingProsody = null;
    }
    autoResize();
  });
</script>

<div class="message-input-container">
  {#if replyTo}
    <div class="reply-indicator">
      <div class="reply-bar"></div>
      <div class="reply-info">
        <span class="replying-to">Replying to {replyTo.role === 'companion' ? companionName : 'You'}</span>
        <span class="reply-preview">{replyTo.content.substring(0, 100)}</span>
      </div>
      <button class="cancel-reply" onclick={handleCancelReply} aria-label="Cancel reply">
        ✕
      </button>
    </div>
  {/if}

  {#if uploadError}
    <div class="upload-error">{uploadError}</div>
  {/if}

  {#if pendingAttachments.length > 0}
    <div class="attachment-strip">
      {#each pendingAttachments as attachment, i}
        <div class="attachment-preview">
          {#if attachment.contentType === 'image'}
            <img src={attachment.url} alt={attachment.filename} class="attachment-thumb" />
          {:else}
            <div class="attachment-file-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
              </svg>
              <span class="attachment-name">{attachment.filename}</span>
            </div>
          {/if}
          <button class="attachment-remove" onclick={() => removeAttachment(i)} aria-label="Remove attachment">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      {/each}
    </div>
  {/if}

  {#if showCommandPalette}
    <CommandPalette
      bind:this={paletteRef}
      filter={commandFilter}
      commands={commandRegistry}
      onselect={handleCommandSelect}
      onclose={() => { showCommandPalette = false; }}
    />
  {/if}

  <div class="input-bar">
    <input
      bind:this={fileInput}
      type="file"
      accept="image/*,audio/*,.pdf,.txt,.md,.json"
      multiple
      onchange={handleFileSelect}
      hidden
      aria-hidden="true"
    />

    <button
      class="attach-button"
      onclick={() => fileInput?.click()}
      disabled={uploading}
      aria-label="Attach file"
      title="Attach file"
    >
      {#if uploading}
        <span class="upload-spinner"></span>
      {:else}
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/>
        </svg>
      {/if}
    </button>

    <VoiceRecorder ontranscript={handleTranscript} />

    <textarea
      bind:this={textarea}
      bind:value={content}
      oninput={handleInput}
      onkeydown={handleKeydown}
      onpaste={handlePaste}
      placeholder="Type a message..."
      rows="1"
      aria-label="Message input"
    ></textarea>

    <VoiceModeToggle />

    {#if isStreaming}
      <button
        class="send-button stop-active"
        onclick={() => onstop?.()}
        aria-label="Stop generation"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <rect x="4" y="4" width="16" height="16" rx="2"/>
        </svg>
      </button>
    {:else}
      <button
        class="send-button"
        onclick={handleSend}
        disabled={!canSend}
        aria-label="Send message"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
        </svg>
      </button>
    {/if}
  </div>
</div>

<style>
  .message-input-container {
    display: flex;
    flex-direction: column;
    background: transparent;
    max-width: 50rem;
    margin: 0 auto;
    padding: 0 1rem 1.5rem;
    position: relative;
    width: 100%;
  }

  .reply-indicator {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    background: var(--bg-tertiary);
    border-bottom: 1px solid var(--border);
  }

  .reply-bar {
    width: 2px;
    height: 2rem;
    background: var(--gold-dim);
    border-radius: 1px;
    flex-shrink: 0;
  }

  .reply-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    overflow: hidden;
  }

  .replying-to {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--gold);
    font-family: var(--font-heading);
    letter-spacing: 0.03em;
  }

  .reply-preview {
    font-size: 0.875rem;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cancel-reply {
    padding: 0.5rem;
    color: var(--text-muted);
    transition: color var(--transition-fast);
  }

  .cancel-reply:hover {
    color: var(--text-secondary);
  }

  .upload-error {
    padding: 0.5rem 1rem;
    font-size: 0.875rem;
    color: var(--error, #ef4444);
    background: rgba(239, 68, 68, 0.1);
    border-bottom: 1px solid var(--border);
  }

  .attachment-strip {
    display: flex;
    gap: 0.5rem;
    padding: 0.75rem 1rem 0;
    overflow-x: auto;
    flex-wrap: wrap;
  }

  .attachment-preview {
    position: relative;
    flex-shrink: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
    background: var(--bg-surface);
  }

  .attachment-thumb {
    width: 4rem;
    height: 4rem;
    object-fit: cover;
    display: block;
  }

  .attachment-file-icon {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.5rem 0.625rem;
    color: var(--text-secondary);
    font-size: 0.75rem;
    max-width: 8rem;
  }

  .attachment-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .attachment-remove {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 1.25rem;
    height: 1.25rem;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.7);
    color: var(--text-primary);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background var(--transition-fast);
  }

  .attachment-remove:hover {
    background: rgba(239, 68, 68, 0.8);
  }

  .input-bar {
    display: flex;
    align-items: flex-end;
    gap: 0.75rem;
    padding: 0.5rem 0.75rem;
    border-radius: var(--radius-lg, 1.5rem);
    background: var(--bg-surface);
    border: 1px solid var(--border);
    transition: border-color var(--transition);
  }

  .input-bar:focus-within {
    border-color: var(--border-hover);
  }

  .attach-button {
    padding: 0.75rem;
    color: var(--text-muted);
    border-radius: var(--radius);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: color var(--transition), background var(--transition);
  }

  .attach-button:hover:not(:disabled) {
    color: var(--gold-dim);
    background: var(--gold-ember);
  }

  .attach-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .upload-spinner {
    width: 20px;
    height: 20px;
    border: 2px solid var(--text-muted);
    border-top-color: var(--gold);
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  textarea {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    border-radius: 0;
    padding: 0.5rem 0.5rem;
    color: var(--text-primary);
    font-size: 1rem;
    line-height: 1.6;
    resize: none;
    max-height: 200px;
    overflow-y: auto;
  }

  textarea:focus {
    outline: none;
  }

  textarea::placeholder {
    color: var(--text-muted);
  }

  .send-button {
    width: 2rem;
    height: 2rem;
    padding: 0;
    background: var(--accent, var(--gold-dim));
    color: white;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all var(--transition);
    flex-shrink: 0;
  }

  .send-button:hover:not(:disabled) {
    background: var(--gold);
  }

  .send-button:disabled {
    opacity: 0.25;
    cursor: not-allowed;
  }

  .send-button.stop-active {
    background: var(--status-error, #ef4444);
    color: white;
  }

  .send-button.stop-active:hover {
    background: #dc2626;
    box-shadow: 0 0 12px rgba(239, 68, 68, 0.3);
  }

  @media (max-width: 768px) {
    .message-input-container {
      padding: 0 0.5rem 1rem;
    }

    .input-bar {
      padding: 0.375rem 0.5rem;
      gap: 0.375rem;
    }

    .attach-button {
      padding: 0.5rem;
    }

    textarea {
      padding: 0.375rem 0.5rem;
    }
  }
</style>
