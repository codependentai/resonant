<script lang="ts">
  import type { Message, MessageSegment } from '@resonant/shared';
  import type { ToolEvent } from '$lib/stores/websocket.svelte';
  import { send } from '$lib/stores/websocket.svelte';
  import { renderMarkdown } from '$lib/utils/markdown';

  let { message, isStreaming = false, streamTokens = '', toolEvents = [], segments = null, companionName = 'Companion' } = $props<{
    message: Message;
    isStreaming?: boolean;
    streamTokens?: string;
    toolEvents?: ToolEvent[];
    segments?: MessageSegment[] | null;
    companionName?: string;
  }>();

  // Format timestamp
  function formatTime(timestamp: string): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  }

  // Determine if message is deleted
  const isDeleted = $derived(!!message.deleted_at);

  // Content type detection
  const contentType = $derived(message.content_type || 'text');
  const metadata = $derived(message.metadata as Record<string, unknown> | null);

  // Render text content
  const renderedContent = $derived(() => {
    if (isDeleted) return '';
    if (isStreaming && streamTokens) return renderMarkdown(streamTokens);
    if (contentType !== 'text') return '';
    return renderMarkdown(message.content);
  });

  // Image lightbox state
  let showLightbox = $state(false);

  // Format file size for display
  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatToolOutput(raw: string): string {
    if (!raw) return '';
    const trimmed = raw.trim();
    if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && trimmed.length > 2) {
      try { return JSON.stringify(JSON.parse(trimmed), null, 2); } catch {}
    }
    return raw;
  }

  // Interleaved segments mode
  const hasSegments = $derived(segments !== null && segments.length > 0);

  // Tool panel state
  let showTools = $state(false);
  let hideInlineTools = $state(false);
  let expandedToolIds = $state<Set<string>>(new Set());
  const hasTools = $derived(toolEvents.length > 0);

  // Thinking block expand/collapse state (tracks by segment index)
  let expandedThinking = $state<Set<number>>(new Set());

  function toggleThinking(index: number) {
    const next = new Set(expandedThinking);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    expandedThinking = next;
  }

  function toggleToolOutput(toolId: string) {
    const next = new Set(expandedToolIds);
    if (next.has(toolId)) next.delete(toolId);
    else next.add(toolId);
    expandedToolIds = next;
  }

  // Custom audio player state
  let audioEl: HTMLAudioElement | null = $state(null);
  let audioPlaying = $state(false);
  let audioDuration = $state(0);
  let audioCurrentTime = $state(0);

  function toggleAudio() {
    if (!audioEl) return;
    if (audioPlaying) {
      audioEl.pause();
    } else {
      audioEl.play();
    }
  }

  function onAudioTimeUpdate() {
    if (audioEl) audioCurrentTime = audioEl.currentTime;
  }

  function onAudioLoaded() {
    if (audioEl && isFinite(audioEl.duration)) audioDuration = audioEl.duration;
  }

  function onAudioEnded() {
    audioPlaying = false;
    audioCurrentTime = 0;
  }

  function onAudioSeek(e: MouseEvent) {
    if (!audioEl || !audioDuration) return;
    const bar = e.currentTarget as HTMLElement;
    const rect = bar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audioEl.currentTime = pct * audioDuration;
  }

  function formatAudioTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // Read aloud (on-demand TTS) — cache blob URLs by message ID across instances
  const ttsCache = (globalThis as Record<string, unknown>).__ttsCache ??= new Map<string, string>();
  let ttsState = $state<'idle' | 'loading' | 'playing'>('idle');
  let ttsAudioEl: HTMLAudioElement | null = null;
  const canReadAloud = $derived(message.role === 'companion' && contentType === 'text' && !isDeleted && message.content.length > 5);

  async function toggleReadAloud() {
    if (ttsState === 'playing' && ttsAudioEl) {
      ttsAudioEl.pause();
      ttsAudioEl = null;
      ttsState = 'idle';
      return;
    }
    if (ttsState === 'loading') return;

    // Create and play a silent audio element NOW (during user gesture)
    // so mobile browsers unlock playback. We swap in the real src once TTS loads.
    const audio = new Audio();
    audio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
    try { await audio.play(); } catch { /* silent unlock attempt */ }
    audio.pause();

    ttsAudioEl = audio;
    const cached = (ttsCache as Map<string, string>).get(message.id);

    try {
      let blobUrl: string;

      if (cached) {
        blobUrl = cached;
      } else {
        ttsState = 'loading';
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ text: message.content }),
        });
        if (!res.ok) throw new Error(`TTS failed: ${res.status}`);
        const blob = await res.blob();
        if (blob.size === 0) throw new Error('TTS returned empty audio');
        blobUrl = URL.createObjectURL(blob);
        (ttsCache as Map<string, string>).set(message.id, blobUrl);
      }

      audio.onended = () => {
        ttsState = 'idle';
        ttsAudioEl = null;
      };
      audio.onerror = () => {
        ttsState = 'idle';
        ttsAudioEl = null;
      };

      audio.src = blobUrl;
      await audio.play();
      ttsState = 'playing';
    } catch (err) {
      console.error('[TTS] Read aloud failed:', err);
      ttsState = 'idle';
      ttsAudioEl = null;
    }
  }

  // Reactions
  interface Reaction { emoji: string; user: string; created_at: string }
  const reactions = $derived(() => {
    const meta = message.metadata as Record<string, unknown> | null;
    if (!meta || !Array.isArray(meta.reactions)) return [] as Reaction[];
    return meta.reactions as Reaction[];
  });

  // Group reactions: { emoji, count, users[] }
  const groupedReactions = $derived(() => {
    const rxns = reactions();
    const map = new Map<string, { emoji: string; count: number; users: string[] }>();
    for (const r of rxns) {
      const entry = map.get(r.emoji);
      if (entry) {
        entry.count++;
        entry.users.push(r.user);
      } else {
        map.set(r.emoji, { emoji: r.emoji, count: 1, users: [r.user] });
      }
    }
    return Array.from(map.values());
  });

  function toggleReaction(emoji: string) {
    const rxns = reactions();
    const myReaction = rxns.find(r => r.emoji === emoji && r.user === 'user');
    if (myReaction) {
      send({ type: 'remove_reaction', messageId: message.id, emoji });
    } else {
      send({ type: 'add_reaction', messageId: message.id, emoji });
    }
  }

  const QUICK_EMOJIS = ['❤️', '😂', '👍', '🔥', '😢', '✨'];
  let pickerOpen = $state(false);
  let pickerEl: HTMLDivElement | undefined = $state();

  function openReactionPicker() {
    pickerOpen = !pickerOpen;
  }

  function pickEmoji(emoji: string) {
    send({ type: 'add_reaction', messageId: message.id, emoji });
    pickerOpen = false;
  }

  function handlePickerClickOutside(e: MouseEvent) {
    if (pickerEl && !pickerEl.contains(e.target as Node)) {
      pickerOpen = false;
    }
  }

  $effect(() => {
    if (pickerOpen) {
      document.addEventListener('click', handlePickerClickOutside, true);
      return () => document.removeEventListener('click', handlePickerClickOutside, true);
    }
  });

  // Read receipt indicator
  const readStatus = $derived(() => {
    if (message.role !== 'user') return null;
    if (message.read_at) return 'read';
    if (message.delivered_at) return 'delivered';
    return 'sent';
  });
</script>

{#if message.role === 'system'}
  <div class="message-system">
    <span class="system-text">{message.content}</span>
  </div>
{:else}
  <article
    class="message {message.role}"
    class:deleted={isDeleted}
    aria-label="{message.role} message"
  >
    <div class="message-header">
      <span class="role">{message.role === 'companion' ? companionName : 'You'}</span>
      <span class="time">{formatTime(message.created_at)}</span>
      {#if message.edited_at && !isDeleted}
        <span class="edited">(edited)</span>
      {/if}
      {#if message.role === 'companion'}
        {#if hasSegments}
          <button
            class="tools-toggle"
            onclick={(e) => { e.stopPropagation(); hideInlineTools = !hideInlineTools; }}
            title="Toggle inline tools"
            aria-label="Toggle inline tools"
          >
            {hideInlineTools ? 'show tools' : 'hide tools'}
          </button>
        {:else if hasTools}
          <button
            class="tools-toggle"
            onclick={(e) => { e.stopPropagation(); showTools = !showTools; }}
            title="Toggle tool activity"
            aria-label="Toggle tool activity"
          >
            {showTools ? 'hide tools' : `${toolEvents.length} tool${toolEvents.length === 1 ? '' : 's'}`}
          </button>
        {/if}
      {/if}
    </div>

    {#if message.reply_to_preview && !isDeleted}
      <div class="reply-preview">
        <div class="reply-bar"></div>
        <div class="reply-content">{message.reply_to_preview}</div>
      </div>
    {/if}

    <div class="message-content">
      {#if isDeleted}
        <span class="deleted-text">This message was deleted</span>
      {:else if contentType === 'image'}
        <div class="media-image">
          <button class="image-button" onclick={() => showLightbox = true} aria-label="View full size">
            <img src={message.content} alt="" loading="lazy" />
          </button>
        </div>
        {#if showLightbox}
          <div class="lightbox" role="dialog" aria-label="Full size image">
            <button class="lightbox-close" onclick={() => showLightbox = false} aria-label="Close">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
            <button class="lightbox-backdrop" onclick={() => showLightbox = false} aria-label="Close lightbox"></button>
            <img src={message.content} alt="" />
          </div>
        {/if}
      {:else if contentType === 'audio'}
        <div class="media-audio">
          <audio
            bind:this={audioEl}
            preload="metadata"
            src={message.content}
            ontimeupdate={onAudioTimeUpdate}
            onloadedmetadata={onAudioLoaded}
            ondurationchange={onAudioLoaded}
            onplay={() => audioPlaying = true}
            onpause={() => audioPlaying = false}
            onended={onAudioEnded}
          >
            <track kind="captions" />
          </audio>
          <div class="audio-player">
            <button class="audio-play-btn" onclick={toggleAudio} aria-label={audioPlaying ? 'Pause' : 'Play'}>
              {#if audioPlaying}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
              {:else}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
              {/if}
            </button>
            <span class="audio-time">{formatAudioTime(audioCurrentTime)}</span>
            <button class="audio-bar" onclick={onAudioSeek} aria-label="Seek">
              <div class="audio-track">
                <div class="audio-progress" style:width="{audioDuration ? (audioCurrentTime / audioDuration) * 100 : 0}%"></div>
              </div>
            </button>
            <span class="audio-time">{formatAudioTime(audioDuration)}</span>
          </div>
          {#if metadata?.transcript}
            <div class="audio-transcript">{metadata.transcript}</div>
          {/if}
        </div>
      {:else if contentType === 'file'}
        <div class="media-file">
          <a href={message.content} download={metadata?.filename || 'download'} class="file-link">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M12 18v-6"/><path d="M9 15l3 3 3-3"/>
            </svg>
            <div class="file-info">
              <span class="file-name">{metadata?.filename || 'File'}</span>
              {#if metadata?.size}
                <span class="file-size">{formatFileSize(metadata.size as number)}</span>
              {/if}
            </div>
          </a>
        </div>
      {:else if hasSegments && !hideInlineTools}
        <!-- Interleaved mode: text, tools, and thinking inline -->
        <div class="interleaved-content">
          {#each segments as seg, i (seg.type === 'tool' ? seg.toolId : `${seg.type}-${i}`)}
            {#if seg.type === 'text'}
              <div class="markdown-content">
                {@html renderMarkdown(seg.content)}
              </div>
            {:else if seg.type === 'thinking'}
              <div class="thinking-block">
                <button class="thinking-header" onclick={(e) => { e.stopPropagation(); toggleThinking(i); }}>
                  <span class="thinking-icon">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                  </span>
                  <span class="thinking-summary">{seg.summary}</span>
                  <span class="thinking-chevron">{expandedThinking.has(i) ? '▾' : '▸'}</span>
                </button>
                {#if expandedThinking.has(i)}
                  <div class="thinking-content">{seg.content}</div>
                {/if}
              </div>
            {:else}
              <div class="inline-tool" class:error={seg.isError}>
                <button
                  class="inline-tool-header"
                  onclick={(e) => { e.stopPropagation(); toggleToolOutput(seg.toolId); }}
                  disabled={!seg.output}
                >
                  <span class="tool-chevron">{expandedToolIds.has(seg.toolId) ? '▾' : '▸'}</span>
                  <span class="tool-name">{seg.toolName}</span>
                  {#if seg.input}
                    <span class="tool-input">{seg.input}</span>
                  {/if}
                  {#if seg.isError}
                    <span class="tool-error-badge">error</span>
                  {/if}
                  {#if !seg.output && isStreaming}
                    <span class="tool-spinner"></span>
                  {/if}
                </button>
                {#if expandedToolIds.has(seg.toolId) && seg.output}
                  <pre class="tool-output">{formatToolOutput(seg.output)}</pre>
                {/if}
              </div>
            {/if}
          {/each}
          {#if isStreaming}
            <span class="cursor">|</span>
          {/if}
        </div>
      {:else}
        <div class="markdown-content">
          {@html renderedContent()}
        </div>
        {#if isStreaming}
          <span class="cursor">|</span>
        {/if}
      {/if}
    </div>

    {#if showTools && hasTools}
      <div class="tools-panel">
        {#each toolEvents as tool (tool.toolId)}
          <div class="tool-entry" class:error={tool.isError}>
            <button
              class="tool-header"
              onclick={(e) => { e.stopPropagation(); toggleToolOutput(tool.toolId); }}
              disabled={!tool.output}
            >
              <span class="tool-chevron">{expandedToolIds.has(tool.toolId) ? '' : ''}</span>
              <span class="tool-name">{tool.toolName}</span>
              {#if tool.input}
                <span class="tool-input">{tool.input}</span>
              {/if}
              {#if tool.isError}
                <span class="tool-error-badge">error</span>
              {/if}
            </button>
            {#if expandedToolIds.has(tool.toolId) && tool.output}
              <pre class="tool-output">{formatToolOutput(tool.output)}</pre>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    {#if !isDeleted && groupedReactions().length > 0}
      <div class="reactions-row">
        {#if canReadAloud}
          <button
            class="read-aloud-btn"
            class:loading={ttsState === 'loading'}
            class:playing={ttsState === 'playing'}
            onclick={toggleReadAloud}
            disabled={ttsState === 'loading'}
            title={ttsState === 'playing' ? 'Stop' : ttsState === 'loading' ? 'Generating...' : 'Read aloud'}
          >
            {#if ttsState === 'loading'}
              <svg class="tts-spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="12"/></svg>
            {:else if ttsState === 'playing'}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
            {:else}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
            {/if}
          </button>
        {/if}
        {#each groupedReactions() as rxn (rxn.emoji)}
          <button
            class="reaction-chip"
            class:mine={rxn.users.includes('user')}
            onclick={() => toggleReaction(rxn.emoji)}
            title={rxn.users.join(', ')}
          >
            <span class="reaction-emoji">{rxn.emoji}</span>
            {#if rxn.count > 1}
              <span class="reaction-count">{rxn.count}</span>
            {/if}
          </button>
        {/each}
        <div class="reaction-picker-wrapper">
          <button class="reaction-add" onclick={openReactionPicker} title="Add reaction">+</button>
          {#if pickerOpen}
            <div class="reaction-quick-pick" bind:this={pickerEl}>
              {#each QUICK_EMOJIS as emoji}
                <button class="quick-emoji" onclick={() => pickEmoji(emoji)}>{emoji}</button>
              {/each}
            </div>
          {/if}
        </div>
      </div>
    {:else if !isDeleted && !isStreaming}
      <div class="reactions-row reactions-hover-only">
        {#if canReadAloud}
          <button
            class="read-aloud-btn"
            class:loading={ttsState === 'loading'}
            class:playing={ttsState === 'playing'}
            onclick={toggleReadAloud}
            disabled={ttsState === 'loading'}
            title={ttsState === 'playing' ? 'Stop' : ttsState === 'loading' ? 'Generating...' : 'Read aloud'}
          >
            {#if ttsState === 'loading'}
              <svg class="tts-spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="12"/></svg>
            {:else if ttsState === 'playing'}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
            {:else}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
            {/if}
          </button>
        {/if}
        <div class="reaction-picker-wrapper">
          <button class="reaction-add" onclick={openReactionPicker} title="Add reaction">+</button>
          {#if pickerOpen}
            <div class="reaction-quick-pick" bind:this={pickerEl}>
              {#each QUICK_EMOJIS as emoji}
                <button class="quick-emoji" onclick={() => pickEmoji(emoji)}>{emoji}</button>
              {/each}
            </div>
          {/if}
        </div>
      </div>
    {/if}

    {#if readStatus() && message.role === 'user'}
      <div class="read-status">
        {#if readStatus() === 'read'}
          <span class="check read" title="Read">&#10003;&#10003;</span>
        {:else if readStatus() === 'delivered'}
          <span class="check" title="Delivered">&#10003;&#10003;</span>
        {:else}
          <span class="check" title="Sent">&#10003;</span>
        {/if}
      </div>
    {/if}
  </article>
{/if}

<style>
  .message-system {
    display: flex;
    justify-content: center;
    margin: 1rem 0;
  }

  .system-text {
    font-size: 0.875rem;
    color: var(--text-muted);
    background: var(--bg-surface);
    padding: 0.5rem 1rem;
    border-radius: var(--radius-sm);
  }

  .message {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    margin: 0.4rem 0;
    padding: 1rem 1.1rem;
    position: relative;
    max-width: 100%;
    overflow-wrap: break-word;
  }

  .message.companion {
    align-self: flex-start;
    width: 100%;
    background: var(--companion-bg);
    border: 1px solid var(--border);
    border-radius: 1.125rem;
    padding-left: 1.1rem;
    box-shadow: inset 0 1px 0 var(--border);
  }

  .message.user {
    align-self: flex-end;
    margin-left: auto;
    max-width: 85%;
    background: var(--user-bg);
    border: 1px solid var(--border);
    border-radius: 1.125rem;
    box-shadow: 0 8px 22px rgba(0, 0, 0, 0.16);
  }

  .message.deleted {
    opacity: 0.6;
  }

  .message-header {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    font-size: 0.875rem;
    flex-wrap: wrap;
  }

  .role {
    display: none;
  }

  .time {
    color: var(--text-muted);
    font-size: 0.75rem;
  }

  .edited {
    color: var(--text-muted);
    font-size: 0.75rem;
    font-style: italic;
  }

  .tools-toggle {
    margin-left: auto;
    font-size: 0.625rem;
    color: var(--text-muted);
    background: transparent;
    border: 1px solid var(--border);
    padding: 0.125rem 0.5rem;
    border-radius: 0.25rem;
    font-family: var(--font-mono);
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .tools-toggle:hover {
    color: var(--text-secondary);
    border-color: var(--border-hover);
  }

  .reply-preview {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.1rem;
    padding: 0.5rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.875rem;
    font-size: 0.875rem;
  }

  .reply-bar {
    width: 2px;
    background: var(--accent);
    border-radius: 1px;
    flex-shrink: 0;
  }

  .reply-content {
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .message-content {
    color: var(--text-primary);
    line-height: 1.5;
    word-wrap: break-word;
    overflow-wrap: break-word;
    min-width: 0;
  }

  .deleted-text {
    font-style: italic;
    color: var(--text-muted);
  }

  /* Tools panel */
  .tools-panel {
    margin-top: 0.5rem;
    padding: 0.5rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.875rem;
    font-size: 0.75rem;
    font-family: var(--font-mono);
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .tool-entry {
    display: flex;
    flex-direction: column;
  }

  .tool-entry.error .tool-name {
    color: var(--error, #ef4444);
  }

  .tool-header {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.25rem 0;
    background: transparent;
    color: var(--text-secondary);
    font-size: 0.75rem;
    font-family: var(--font-mono);
    cursor: pointer;
    text-align: left;
    border-radius: 0.25rem;
    transition: background 0.15s;
  }

  .tool-header:hover {
    background: var(--bg-hover);
  }

  .tool-header:disabled {
    cursor: default;
  }

  .tool-chevron {
    width: 1rem;
    text-align: center;
    flex-shrink: 0;
    font-size: 0.625rem;
  }

  .tool-entry .tool-name {
    color: var(--accent);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .tool-entry .tool-input {
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.6875rem;
  }

  .tool-error-badge {
    font-size: 0.5625rem;
    color: var(--error, #ef4444);
    background: rgba(239, 68, 68, 0.15);
    padding: 0.0625rem 0.25rem;
    border-radius: 0.125rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .tool-output {
    margin: 0.25rem 0 0.25rem 1rem;
    padding: 0.5rem;
    background: var(--bg-primary);
    border-radius: 0.25rem;
    color: var(--text-muted);
    font-size: 0.6875rem;
    line-height: 1.4;
    max-height: 200px;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
  }

  /* Interleaved content */
  .interleaved-content {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .inline-tool {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    margin: 0.375rem 0;
    padding: 0.25rem 0.625rem;
    font-size: 0.75rem;
    font-family: var(--font-mono);
  }

  .inline-tool.error {
    border-color: var(--error, #ef4444);
  }

  .inline-tool-header {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.1875rem 0;
    background: transparent;
    color: var(--text-secondary);
    font-size: 0.75rem;
    font-family: var(--font-mono);
    cursor: pointer;
    text-align: left;
    border-radius: 0.25rem;
    transition: background 0.15s;
  }

  .inline-tool-header:hover {
    background: var(--bg-hover);
  }

  .inline-tool-header:disabled {
    cursor: default;
  }

  /* Thinking blocks — collapsible reasoning */
  .thinking-block {
    margin: 0.375rem 0;
    font-size: 0.75rem;
    font-family: var(--font-mono);
  }

  .thinking-header {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.25rem 0.5rem;
    background: var(--bg-tertiary);
    color: var(--text-muted);
    font-size: 0.75rem;
    font-family: var(--font-mono);
    cursor: pointer;
    text-align: left;
    border-radius: 0.25rem;
    transition: background 0.15s;
    width: 100%;
  }

  .thinking-header:hover {
    background: var(--bg-hover);
    color: var(--text-secondary);
  }

  .thinking-icon {
    flex-shrink: 0;
    color: var(--accent);
    display: flex;
    align-items: center;
  }

  .thinking-summary {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-secondary);
  }

  .thinking-chevron {
    flex-shrink: 0;
    font-size: 0.625rem;
    color: var(--text-muted);
  }

  .thinking-content {
    margin: 0.25rem 0 0.25rem 0;
    padding: 0.5rem 0.625rem;
    background: var(--bg-primary);
    border-radius: 0 0 0.25rem 0.25rem;
    color: var(--text-muted);
    font-size: 0.6875rem;
    line-height: 1.5;
    max-height: 300px;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .tool-spinner {
    width: 0.625rem;
    height: 0.625rem;
    border: 1.5px solid var(--accent);
    border-top-color: transparent;
    border-radius: 50%;
    animation: toolSpin 0.8s linear infinite;
    flex-shrink: 0;
  }

  @keyframes toolSpin {
    to { transform: rotate(360deg); }
  }

  /* Read aloud button — inline with reaction chips */
  .read-aloud-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 26px;
    width: 26px;
    padding: 0;
    border-radius: var(--radius);
    color: var(--text-muted);
    transition: color var(--transition), background var(--transition);
  }

  .read-aloud-btn:hover:not(:disabled) {
    color: var(--accent);
    background: var(--bg-hover);
  }

  .read-aloud-btn.playing {
    color: var(--accent);
  }

  .read-aloud-btn:disabled {
    cursor: wait;
  }

  .tts-spinner {
    animation: toolSpin 0.8s linear infinite;
  }

  /* Reactions */
  .reactions-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-top: 0.25rem;
  }

  .reactions-hover-only {
    opacity: 0;
    transition: opacity 0.15s;
  }

  .message:hover .reactions-hover-only {
    opacity: 1;
  }

  .reaction-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.1875rem;
    padding: 0.25rem 0.5rem;
    background: var(--bg-hover);
    border: 1px solid var(--border);
    border-radius: 999px;
    cursor: pointer;
    font-size: 0.875rem;
    transition: all 0.15s;
  }

  .reaction-chip:hover {
    background: var(--bg-hover);
    border-color: var(--border-hover);
  }

  .reaction-chip.mine {
    background: var(--bg-active);
    border-color: var(--accent);
  }

  .reaction-emoji {
    font-size: 0.9375rem;
    line-height: 1;
  }

  .reaction-count {
    font-size: 0.6875rem;
    color: var(--text-muted);
    font-family: var(--font-mono);
  }

  .reaction-add {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.75rem;
    height: 1.75rem;
    background: transparent;
    border: 1px dashed var(--border);
    border-radius: 50%;
    color: var(--text-muted);
    font-size: 0.875rem;
    cursor: pointer;
    transition: all 0.15s;
    line-height: 1;
  }

  .reaction-add:hover {
    border-color: var(--border-hover);
    color: var(--text-secondary);
    background: var(--bg-hover);
  }

  .reaction-picker-wrapper {
    position: relative;
    display: inline-flex;
  }

  .reaction-quick-pick {
    position: absolute;
    bottom: calc(100% + 4px);
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 2px;
    padding: 4px 6px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 0.875rem;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    z-index: 10;
    white-space: nowrap;
  }

  .quick-emoji {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    background: transparent;
    border: none;
    border-radius: 4px;
    font-size: 1.1rem;
    cursor: pointer;
    transition: background 0.12s;
  }

  .quick-emoji:hover {
    background: var(--bg-hover);
  }

  .read-status {
    display: flex;
    justify-content: flex-end;
    margin-top: 0.05rem;
  }

  .check {
    font-size: 0.75rem;
    color: var(--text-muted);
    letter-spacing: -0.25em;
  }

  .check.read {
    color: var(--accent);
  }

  .markdown-content :global(p) {
    margin: 0.5rem 0;
  }

  .markdown-content :global(p:first-child) {
    margin-top: 0;
  }

  .markdown-content :global(p:last-child) {
    margin-bottom: 0;
  }

  .markdown-content :global(code) {
    background: var(--bg-tertiary);
    padding: 0.125rem 0.25rem;
    border-radius: 0.25rem;
    font-family: var(--font-mono);
    font-size: 0.875em;
  }

  .markdown-content :global(pre) {
    background: var(--bg-tertiary);
    padding: 0.75rem;
    border-radius: var(--radius-sm);
    overflow-x: auto;
    margin: 0.5rem 0;
  }

  .markdown-content :global(pre code) {
    background: none;
    padding: 0;
  }

  .markdown-content :global(a) {
    color: var(--accent);
    text-decoration: underline;
    text-decoration-color: var(--accent-muted);
  }

  .markdown-content :global(strong) {
    font-weight: 600;
  }

  .markdown-content :global(em) {
    font-style: italic;
  }

  .markdown-content :global(ul),
  .markdown-content :global(ol) {
    margin: 0.5rem 0;
    padding-left: 1.5rem;
  }

  .markdown-content :global(blockquote) {
    border-left: 2px solid var(--accent-muted);
    padding-left: 1rem;
    margin: 0.5rem 0;
    color: var(--text-secondary);
  }

  /* Media: Image */
  .media-image {
    margin: 0.25rem 0;
  }

  .image-button {
    display: block;
    padding: 0;
    background: none;
    cursor: pointer;
    border-radius: var(--radius-sm);
    overflow: hidden;
  }

  .media-image img {
    max-width: 100%;
    max-height: 400px;
    border-radius: var(--radius-sm);
    display: block;
    object-fit: contain;
  }

  .lightbox {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
  }

  .lightbox-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.85);
  }

  .lightbox-close {
    position: absolute;
    top: 1rem;
    right: 1rem;
    z-index: 1001;
    padding: 0.5rem;
    color: white;
    background: var(--bg-active);
    border-radius: 50%;
    transition: background 0.2s;
  }

  .lightbox-close:hover {
    background: var(--bg-hover);
  }

  .lightbox img {
    max-width: 90vw;
    max-height: 90vh;
    object-fit: contain;
    z-index: 1001;
    border-radius: var(--radius-sm);
  }

  /* Media: Audio — custom player */
  .media-audio {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin: 0.25rem 0;
  }

  .media-audio audio {
    display: none;
  }

  .audio-player {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    padding: 0.5rem 0.25rem;
    min-width: 220px;
    max-width: 320px;
  }

  .audio-play-btn {
    width: 2rem;
    height: 2rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: var(--accent);
    color: var(--bg-primary);
    flex-shrink: 0;
    transition: all var(--transition);
    cursor: pointer;
  }

  .audio-play-btn:hover {
    background: var(--accent-hover);
  }

  .audio-time {
    font-size: 0.6875rem;
    font-family: var(--font-mono);
    color: var(--text-secondary);
    min-width: 2.25rem;
    text-align: center;
    flex-shrink: 0;
  }

  .audio-bar {
    flex: 1;
    padding: 0.5rem 0;
    cursor: pointer;
    background: none;
  }

  .audio-track {
    height: 3px;
    background: var(--border-hover);
    border-radius: 2px;
    position: relative;
    overflow: hidden;
  }

  .audio-progress {
    height: 100%;
    background: var(--accent);
    border-radius: 2px;
    transition: width 0.1s linear;
  }

  .audio-bar:hover .audio-track {
    height: 4px;
  }

  .audio-bar:hover .audio-progress {
    background: var(--accent-hover);
  }

  .audio-transcript {
    font-size: 0.875rem;
    color: var(--text-secondary);
    font-style: italic;
  }

  /* Media: File */
  .media-file {
    margin: 0.25rem 0;
  }

  .file-link {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem;
    background: var(--bg-tertiary);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    text-decoration: none;
    transition: background 0.2s;
  }

  .file-link:hover {
    background: var(--bg-hover);
  }

  .file-link svg {
    flex-shrink: 0;
    color: var(--accent);
  }

  .file-info {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    overflow: hidden;
  }

  .file-name {
    font-size: 0.875rem;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-size {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .cursor {
    display: inline-block;
    animation: blink 1s infinite;
    color: var(--accent);
    margin-left: 0.125rem;
  }

  @keyframes blink {
    0%, 49% { opacity: 1; }
    50%, 100% { opacity: 0; }
  }

  @media (max-width: 768px) {
    .message.user {
      max-width: 90%;
    }

    .message {
      overflow: hidden;
    }

    .message-content {
      overflow: hidden;
    }

    .tool-output {
      max-width: calc(100vw - 4rem);
    }

    .markdown-content :global(pre) {
      max-width: calc(100vw - 4rem);
    }

    .tools-panel {
      max-width: calc(100vw - 4rem);
      overflow: hidden;
    }

    .interleaved-content {
      max-width: calc(100vw - 4rem);
      overflow: hidden;
    }

    .lightbox {
      padding: 0;
    }

    .lightbox-close {
      top: max(env(safe-area-inset-top, 0.5rem), 0.75rem);
      right: 0.75rem;
      padding: 0.75rem;
      background: rgba(0, 0, 0, 0.6);
      z-index: 1002;
    }

    .lightbox img {
      max-width: 100vw;
      max-height: 100vh;
      border-radius: 0;
    }
  }
</style>
