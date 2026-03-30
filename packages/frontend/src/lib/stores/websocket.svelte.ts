import type { ServerMessage, ClientMessage, Message, Canvas, ThreadSummary, PresenceStatus, SystemStatus, MessageSegment, CommandRegistryEntry } from '@resonant/shared';
import { setSystemStatus } from './settings.svelte';

// Connection state
let wsInstance: WebSocket | null = $state(null);
let connectionState = $state<'connected' | 'disconnecting' | 'disconnected' | 'reconnecting'>('disconnected');
let reconnectAttempt = $state(0);
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let heartbeatTimeout: ReturnType<typeof setTimeout> | null = null;
let visibilityHandler: (() => void) | null = null;

// Data state
let messages = $state<Message[]>([]);
let threads = $state<ThreadSummary[]>([]);
let activeThreadId = $state<string | null>(null);
let presence = $state<PresenceStatus>('offline');
let unreadCounts = $state<Record<string, number>>({});

// Streaming state
let streamingMessageId = $state<string | null>(null);
let streamingTokens = $state<string>('');

// Tool events per message
export type ToolEvent = {
  toolId: string;
  toolName: string;
  input?: string;
  output?: string;
  isError?: boolean;
  isComplete: boolean;
  timestamp: string;
  elapsed?: number;
};
let toolEvents = $state<Record<string, ToolEvent[]>>({});
let toolOffsets = $state<Record<string, Array<{ toolId: string; textOffset: number }>>>({});

// Thinking events per streaming message
export type ThinkingEvent = { content: string; summary: string; textOffset: number };
let thinkingEvents = $state<Record<string, ThinkingEvent[]>>({});

// Voice state
let voiceModeEnabled = $state(false);
let transcriptionStatus = $state<'idle' | 'processing' | 'complete' | 'error'>('idle');
let transcriptionText = $state<string | null>(null);
let transcriptionError = $state<string | null>(null);
let transcriptionProsody = $state<Record<string, number> | null>(null);

// TTS playback state
let ttsPlaying = $state(false);
let ttsMessageId = $state<string | null>(null);
let ttsAudioQueue = $state<Array<{ messageId: string; data: string; final: boolean }>>([]);

// Context usage state
let contextUsage = $state<{ percentage: number; tokensUsed: number; contextWindow: number } | null>(null);
let compactionNotice = $state<{ preTokens: number; message: string; isComplete: boolean } | null>(null);
let compactionTimeout: ReturnType<typeof setTimeout> | null = null;

// Rate limit state
let rateLimitInfo = $state<{ status: string; resetsAt?: number; rateLimitType?: string } | null>(null);
let rateLimitTimeout: ReturnType<typeof setTimeout> | null = null;

// Rewind state
let rewindResult = $state<{ canRewind: boolean; filesChanged?: string[]; insertions?: number; deletions?: number; error?: string } | null>(null);

// Command state
let commandRegistry = $state<CommandRegistryEntry[]>([]);
let lastCommandResult = $state<{ name: string; success: boolean; data?: Record<string, unknown>; error?: string; display?: string } | null>(null);
let commandResultTimeout: ReturnType<typeof setTimeout> | null = null;

// Canvas state
let canvases = $state<Canvas[]>([]);
let activeCanvasId = $state<string | null>(null);

// Notification state
let notificationPermission = $state<NotificationPermission>(
  typeof Notification !== 'undefined' ? Notification.permission : 'default'
);

function showLocalNotification(title: string, body: string): void {
  if (typeof document === 'undefined' || typeof Notification === 'undefined') return;
  if (!document.hidden) return; // Only when tab is not focused
  // Check real browser permission, not stale state (permission may have been
  // granted via push subscription flow without updating our state variable)
  const permission = Notification.permission;
  if (permission !== 'granted') return;

  new Notification(title, {
    body,
    icon: '/icons/icon-192.png',
    tag: 'resonant-local',
  });
}

export function getNotificationPermission(): NotificationPermission {
  // Return live browser value when available, state as fallback (SSR)
  if (typeof Notification !== 'undefined') {
    return Notification.permission;
  }
  return notificationPermission;
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof Notification === 'undefined') return 'denied';
  const result = await Notification.requestPermission();
  notificationPermission = result;
  return result;
}

// Error state
let lastError = $state<{ code: string; message: string } | null>(null);
let pendingMessages = $state<Array<{ threadId: string; content: string; contentType: string; replyToId?: string }>>([]);

// Last seen sequence for sync
let lastSeenSequence = $state(0);

function getWebSocketUrl(): string {
  if (typeof window === 'undefined') return '';
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = import.meta.env.DEV ? 'localhost:3002' : window.location.host;
  return `${protocol}//${host}/ws`;
}

function getReconnectDelay(): number {
  const delays = [500, 1000, 2000, 4000, 8000, 15000, 30000];
  return delays[Math.min(reconnectAttempt, delays.length - 1)];
}

function clearTimers() {
  if (reconnectTimeout) { clearTimeout(reconnectTimeout); reconnectTimeout = null; }
  if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
  if (heartbeatTimeout) { clearTimeout(heartbeatTimeout); heartbeatTimeout = null; }
}

function startHeartbeat() {
  heartbeatInterval = setInterval(() => {
    if (wsInstance?.readyState === WebSocket.OPEN) {
      wsInstance.send(JSON.stringify({ type: 'ping' }));
      heartbeatTimeout = setTimeout(() => {
        console.warn('Heartbeat timeout — no pong received');
        wsInstance?.close();
      }, 5000);
    }
  }, 30000);
}

function handleMessage(event: MessageEvent) {
  try {
    const msg: ServerMessage = JSON.parse(event.data);

    switch (msg.type) {
      case 'pong':
        if (heartbeatTimeout) { clearTimeout(heartbeatTimeout); heartbeatTimeout = null; }
        break;

      case 'connected':
        // Initial connection — receive thread list and presence
        threads = msg.threads;
        presence = msg.sessionStatus;
        // Only set activeThreadId on fresh connect — on reconnect, preserve whatever
        // thread the user was viewing (prevents mobile app-switch from silently
        // switching to today's daily thread while showing old messages)
        if (msg.activeThreadId && !activeThreadId) activeThreadId = msg.activeThreadId;
        // Build unread counts from thread list
        for (const t of msg.threads) {
          unreadCounts[t.id] = t.unread_count;
        }
        // Command registry
        if (msg.commands) commandRegistry = msg.commands;
        break;

      case 'message':
        if (msg.message.thread_id === activeThreadId) {
          messages = [...messages, msg.message];
        }
        // Update last seen sequence
        if (msg.message.sequence > lastSeenSequence) {
          lastSeenSequence = msg.message.sequence;
        }
        // Update thread preview
        threads = threads.map(t =>
          t.id === msg.message.thread_id
            ? { ...t, last_message_preview: msg.message.content.substring(0, 100), last_activity_at: msg.message.created_at }
            : t
        );
        // Local notification for companion messages (timers, system-injected)
        if (msg.message.role === 'companion') {
          const preview = msg.message.content.substring(0, 120).replace(/\n/g, ' ');
          showLocalNotification('Companion', preview);
        }
        break;

      case 'message_edited':
        messages = messages.map(m =>
          m.id === msg.messageId
            ? { ...m, content: msg.newContent, edited_at: msg.editedAt }
            : m
        );
        break;

      case 'message_deleted':
        messages = messages.map(m =>
          m.id === msg.messageId
            ? { ...m, deleted_at: new Date().toISOString() }
            : m
        );
        break;

      case 'stream_start':
        streamingMessageId = msg.messageId;
        streamingTokens = '';
        break;

      case 'stream_token':
        if (streamingMessageId === msg.messageId) {
          streamingTokens = msg.token; // Replace with cumulative text from backend
        }
        break;

      case 'stream_end':
        // Replace streaming state with the final message
        if (msg.final && msg.final.thread_id === activeThreadId) {
          messages = [...messages, msg.final];
        }
        // Local notification for streamed companion messages
        if (msg.final?.role === 'companion') {
          const preview = msg.final.content.substring(0, 120).replace(/\n/g, ' ');
          showLocalNotification('Companion', preview);
        }
        // Clean up streaming offsets and thinking events
        if (streamingMessageId) {
          if (toolOffsets[streamingMessageId]) {
            const { [streamingMessageId]: _, ...rest } = toolOffsets;
            toolOffsets = rest;
          }
          if (thinkingEvents[streamingMessageId]) {
            const { [streamingMessageId]: __, ...rest2 } = thinkingEvents;
            thinkingEvents = rest2;
          }
        }
        streamingMessageId = null;
        streamingTokens = '';
        break;

      case 'presence':
        presence = msg.status;
        break;

      case 'unread_update':
        unreadCounts = { ...unreadCounts, [msg.threadId]: msg.count };
        threads = threads.map(t =>
          t.id === msg.threadId ? { ...t, unread_count: msg.count } : t
        );
        // Update read_at on messages in the current thread
        if (msg.threadId === activeThreadId && msg.count === 0) {
          const now = new Date().toISOString();
          messages = messages.map(m =>
            m.role === 'companion' && !m.read_at ? { ...m, read_at: now } : m
          );
        }
        break;

      case 'thread_created':
        threads = [{
          id: msg.thread.id,
          name: msg.thread.name,
          type: msg.thread.type,
          unread_count: 0,
          last_activity_at: msg.thread.created_at,
          last_message_preview: null,
          pinned_at: null,
        }, ...threads];
        break;

      case 'thread_list':
        threads = msg.threads;
        break;

      case 'thread_deleted':
        threads = threads.filter(t => t.id !== msg.threadId);
        if (activeThreadId === msg.threadId) {
          activeThreadId = threads.length > 0 ? threads[0].id : null;
          if (activeThreadId) loadThread(activeThreadId);
          else messages = [];
        }
        break;

      case 'thread_updated':
        threads = threads.map(t =>
          t.id === msg.thread.id ? { ...t, name: msg.thread.name, pinned_at: msg.thread.pinned_at } : t
        );
        break;

      case 'message_reaction_added': {
        const idx = messages.findIndex(m => m.id === msg.messageId);
        if (idx !== -1) {
          const m = messages[idx];
          const meta = (m.metadata && typeof m.metadata === 'object') ? { ...m.metadata } : {};
          const reactions: Array<{ emoji: string; user: string; created_at: string }> = Array.isArray(meta.reactions) ? [...meta.reactions] : [];
          if (!reactions.some(r => r.emoji === msg.emoji && r.user === msg.user)) {
            reactions.push({ emoji: msg.emoji, user: msg.user, created_at: msg.createdAt });
            const updated = { ...m, metadata: { ...meta, reactions } };
            messages = [...messages.slice(0, idx), updated, ...messages.slice(idx + 1)];
          }
        }
        break;
      }

      case 'message_reaction_removed': {
        const idx = messages.findIndex(m => m.id === msg.messageId);
        if (idx !== -1) {
          const m = messages[idx];
          const meta = (m.metadata && typeof m.metadata === 'object') ? { ...m.metadata } : {};
          const reactions: Array<{ emoji: string; user: string; created_at: string }> = Array.isArray(meta.reactions) ? [...meta.reactions] : [];
          const filtered = reactions.filter(r => !(r.emoji === msg.emoji && r.user === msg.user));
          const updated = { ...m, metadata: { ...meta, reactions: filtered } };
          messages = [...messages.slice(0, idx), updated, ...messages.slice(idx + 1)];
        }
        break;
      }

      case 'context_usage':
        contextUsage = { percentage: msg.percentage, tokensUsed: msg.tokensUsed, contextWindow: msg.contextWindow };
        break;

      case 'compaction_notice':
        compactionNotice = { preTokens: msg.preTokens, message: msg.message, isComplete: msg.isComplete };
        if (compactionTimeout) clearTimeout(compactionTimeout);
        if (msg.isComplete) {
          // Compaction finished — reset context usage and auto-hide after 8s
          contextUsage = null;
          compactionTimeout = setTimeout(() => { compactionNotice = null; }, 8000);
        }
        // When !isComplete (in-progress), no timeout — banner stays until completion
        break;

      case 'sync_response':
        if (msg.messages.length > 0) {
          // Merge missed messages, avoiding duplicates
          const existingIds = new Set(messages.map(m => m.id));
          const newMsgs = msg.messages.filter(m => !existingIds.has(m.id));
          if (newMsgs.length > 0) {
            messages = [...messages, ...newMsgs].sort((a, b) => a.sequence - b.sequence);
            const last = newMsgs[newMsgs.length - 1];
            if (last.sequence > lastSeenSequence) lastSeenSequence = last.sequence;
          }
        }
        break;

      case 'tool_use':
        if (streamingMessageId) {
          const events = toolEvents[streamingMessageId] || [];
          toolEvents = {
            ...toolEvents,
            [streamingMessageId]: [...events, {
              toolId: msg.toolId,
              toolName: msg.toolName,
              input: msg.input,
              isComplete: false,
              timestamp: new Date().toISOString(),
            }],
          };
          // Track text offset for interleaved rendering
          if (msg.textOffset !== undefined) {
            const offsets = toolOffsets[streamingMessageId] || [];
            toolOffsets = {
              ...toolOffsets,
              [streamingMessageId]: [...offsets, { toolId: msg.toolId, textOffset: msg.textOffset }],
            };
          }
        }
        break;

      case 'tool_result':
        if (streamingMessageId) {
          const currentEvents = toolEvents[streamingMessageId] || [];
          toolEvents = {
            ...toolEvents,
            [streamingMessageId]: currentEvents.map(e =>
              e.toolId === msg.toolId
                ? { ...e, output: msg.output, isError: msg.isError, isComplete: true }
                : e
            ),
          };
        }
        break;

      case 'thinking':
        if (streamingMessageId) {
          const existing = thinkingEvents[streamingMessageId] || [];
          thinkingEvents = {
            ...thinkingEvents,
            [streamingMessageId]: [...existing, {
              content: msg.content,
              summary: msg.summary,
              textOffset: streamingTokens.length,
            }],
          };
        }
        break;

      case 'voice_mode_ack':
        voiceModeEnabled = msg.enabled;
        break;

      case 'transcription_status':
        transcriptionStatus = msg.status;
        if (msg.status === 'complete') {
          transcriptionText = msg.text ?? null;
          transcriptionProsody = msg.prosody ?? null;
          transcriptionError = null;
        } else if (msg.status === 'error') {
          transcriptionError = msg.error ?? 'Transcription failed';
          transcriptionText = null;
          transcriptionProsody = null;
        } else {
          transcriptionText = null;
          transcriptionError = null;
          transcriptionProsody = null;
        }
        break;

      case 'tts_start':
        ttsPlaying = true;
        ttsMessageId = msg.messageId;
        break;

      case 'tts_audio':
        ttsAudioQueue = [...ttsAudioQueue, { messageId: msg.messageId, data: msg.data, final: msg.final }];
        break;

      case 'tts_end':
        ttsMessageId = null;
        // ttsPlaying stays true until AudioAutoPlayer finishes playback
        break;

      case 'system_status':
        setSystemStatus(msg.status);
        break;

      case 'canvas_created':
        canvases = [msg.canvas, ...canvases];
        activeCanvasId = msg.canvas.id;
        break;

      case 'canvas_updated': {
        canvases = canvases.map(c =>
          c.id === msg.canvasId
            ? {
                ...c,
                content: msg.content,
                title: msg.title ?? c.title,
                updated_at: msg.updatedAt,
              }
            : c
        );
        break;
      }

      case 'canvas_deleted':
        canvases = canvases.filter(c => c.id !== msg.canvasId);
        if (activeCanvasId === msg.canvasId) activeCanvasId = null;
        break;

      case 'canvas_list':
        canvases = msg.canvases;
        break;

      case 'generation_stopped':
        streamingMessageId = null;
        streamingTokens = '';
        break;

      case 'rate_limit':
        rateLimitInfo = { status: msg.status, resetsAt: msg.resetsAt, rateLimitType: msg.rateLimitType };
        if (rateLimitTimeout) clearTimeout(rateLimitTimeout);
        // Auto-clear after resetsAt or 30s default
        const clearMs = msg.resetsAt ? Math.max(0, msg.resetsAt * 1000 - Date.now()) + 2000 : 30000;
        rateLimitTimeout = setTimeout(() => { rateLimitInfo = null; }, clearMs);
        break;

      case 'tool_progress':
        if (streamingMessageId) {
          const currentEvents = toolEvents[streamingMessageId] || [];
          toolEvents = {
            ...toolEvents,
            [streamingMessageId]: currentEvents.map(e =>
              e.toolId === msg.toolId ? { ...e, elapsed: msg.elapsed } : e
            ),
          };
        }
        break;

      case 'mcp_status_updated':
        // Update system status MCP servers if we have a cached status
        setSystemStatus(null, msg.servers);
        break;

      case 'rewind_result':
        rewindResult = { canRewind: msg.canRewind, filesChanged: msg.filesChanged, insertions: msg.insertions, deletions: msg.deletions, error: msg.error };
        break;

      case 'command_result':
        lastCommandResult = { name: msg.name, success: msg.success, data: msg.data, error: msg.error, display: msg.display };
        // Inject as a system message in chat
        if (msg.display !== 'silent' && activeThreadId) {
          const text = msg.error
            ? `/${msg.name}: ${msg.error}`
            : (msg.data as Record<string, unknown>)?.message as string || `/${msg.name}: done`;
          const sysMsg: Message = {
            id: `cmd-${Date.now()}`,
            thread_id: activeThreadId,
            sequence: messages.length > 0 ? messages[messages.length - 1].sequence + 1 : 1,
            role: 'system',
            content: text,
            content_type: 'text',
            platform: 'web',
            metadata: null,
            reply_to_id: null,
            reply_to_preview: null,
            original_content: null,
            created_at: new Date().toISOString(),
            delivered_at: null,
            edited_at: null,
            deleted_at: null,
            read_at: null,
          };
          messages = [...messages, sysMsg];
        }
        break;

      case 'error':
        console.error(`Server error [${msg.code}]: ${msg.message}`);
        lastError = { code: msg.code, message: msg.message };
        // Auto-clear error after 10 seconds
        setTimeout(() => { lastError = null; }, 10000);
        break;
    }
  } catch (err) {
    console.error('Failed to parse WebSocket message:', err);
  }
}

export function connect() {
  if (wsInstance?.readyState === WebSocket.OPEN) return;

  clearTimers();
  const url = getWebSocketUrl();

  try {
    wsInstance = new WebSocket(url);
    connectionState = reconnectAttempt > 0 ? 'reconnecting' : 'disconnected';

    wsInstance.onopen = () => {
      console.log('WebSocket connected');
      connectionState = 'connected';
      reconnectAttempt = 0;
      lastError = null;
      startHeartbeat();

      // Send initial tab visibility state
      send({ type: 'visibility', visible: !document.hidden });

      // Track tab visibility changes (single listener, cleaned up on disconnect)
      if (visibilityHandler) document.removeEventListener('visibilitychange', visibilityHandler);
      visibilityHandler = () => send({ type: 'visibility', visible: !document.hidden });
      document.addEventListener('visibilitychange', visibilityHandler);

      // Sync if reconnecting
      if (lastSeenSequence > 0 && activeThreadId) {
        send({
          type: 'sync',
          lastSeenSequence,
          threadId: activeThreadId,
        });
      }

      // Drain pending messages queued while disconnected
      if (pendingMessages.length > 0) {
        const queued = [...pendingMessages];
        pendingMessages = [];
        for (const msg of queued) {
          send({
            type: 'message',
            threadId: msg.threadId,
            content: msg.content,
            contentType: msg.contentType as 'text',
            replyToId: msg.replyToId,
          });
        }
      }
    };

    wsInstance.onmessage = handleMessage;

    wsInstance.onclose = () => {
      connectionState = 'disconnected';
      clearTimers();
      reconnectAttempt++;
      const delay = getReconnectDelay();
      console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttempt})`);
      reconnectTimeout = setTimeout(() => {
        connectionState = 'reconnecting';
        connect();
      }, delay);
    };

    wsInstance.onerror = (err) => {
      console.error('WebSocket error:', err);
    };
  } catch (err) {
    console.error('Failed to create WebSocket:', err);
    connectionState = 'disconnected';
  }
}

export function disconnect() {
  clearTimers();
  if (visibilityHandler) {
    document.removeEventListener('visibilitychange', visibilityHandler);
    visibilityHandler = null;
  }
  if (wsInstance) {
    connectionState = 'disconnecting';
    wsInstance.close();
    wsInstance = null;
  }
  connectionState = 'disconnected';
  reconnectAttempt = 0;
}

export function send(msg: ClientMessage) {
  if (wsInstance?.readyState === WebSocket.OPEN) {
    wsInstance.send(JSON.stringify(msg));
  } else if (msg.type === 'message') {
    // Queue messages for retry when reconnected
    pendingMessages = [...pendingMessages, {
      threadId: msg.threadId,
      content: msg.content,
      contentType: msg.contentType,
      replyToId: msg.replyToId,
    }];
    console.warn('Message queued — will send on reconnect');
  } else {
    console.warn('Cannot send: WebSocket not connected');
  }
}

export async function loadThread(threadId: string) {
  activeThreadId = threadId;
  try {
    const response = await fetch(`/api/threads/${threadId}/messages`);
    if (!response.ok) throw new Error('Failed to load messages');
    const data = await response.json();
    messages = data.messages || [];
    if (messages.length > 0) {
      const last = messages[messages.length - 1];
      if (last.sequence > lastSeenSequence) lastSeenSequence = last.sequence;
    }
    // Mark as read
    if (messages.length > 0) {
      send({ type: 'read', threadId, beforeId: messages[messages.length - 1].id });
    }
  } catch (err) {
    console.error('Failed to load thread:', err);
    messages = [];
  }
}

// Load older messages (pagination — prepend to existing)
// Returns true if there were more messages, false if we've reached the beginning
export async function loadOlderMessages(threadId: string): Promise<boolean> {
  if (messages.length === 0) return false;
  const oldestMessage = messages[0];
  try {
    const response = await fetch(`/api/threads/${threadId}/messages?before=${oldestMessage.id}&limit=50`);
    if (!response.ok) throw new Error('Failed to load older messages');
    const data = await response.json();
    const older = data.messages || [];
    if (older.length === 0) return false;
    messages = [...older, ...messages];
    return older.length >= 50; // If we got a full page, there might be more
  } catch (err) {
    console.error('Failed to load older messages:', err);
    return false;
  }
}

export async function loadThreads() {
  try {
    const response = await fetch('/api/threads');
    if (!response.ok) throw new Error('Failed to load threads');
    const data = await response.json();
    threads = data.threads || [];
  } catch (err) {
    console.error('Failed to load threads:', err);
    threads = [];
  }
}

// Getters for reactive state
export function getConnectionState() { return connectionState; }
export function getMessages() { return messages; }
export function getThreads() { return threads; }
export function getActiveThreadId() { return activeThreadId; }
export function getPresence() { return presence; }
export function getUnreadCounts() { return unreadCounts; }
export function getStreamingState() {
  return { messageId: streamingMessageId, tokens: streamingTokens };
}
export function getLastError() { return lastError; }
export function getPendingCount() { return pendingMessages.length; }
export function clearError() { lastError = null; }
export function getToolEvents() { return toolEvents; }

// Compute interleaved segments for the currently streaming message
export function getStreamingSegments(): MessageSegment[] | null {
  if (!streamingMessageId) return null;
  const offsets = toolOffsets[streamingMessageId] || [];
  const thinking = thinkingEvents[streamingMessageId] || [];
  if (offsets.length === 0 && thinking.length === 0) return null;

  const events = toolEvents[streamingMessageId] || [];
  const eventMap = new Map(events.map(e => [e.toolId, e]));

  // Merge all insertions into one sorted list
  type Insertion = { textOffset: number } & (
    | { kind: 'tool'; toolId: string }
    | { kind: 'thinking'; content: string; summary: string }
  );

  const allInsertions: Insertion[] = [
    ...offsets.map(o => ({ textOffset: o.textOffset, kind: 'tool' as const, toolId: o.toolId })),
    ...thinking.map(t => ({ textOffset: t.textOffset, kind: 'thinking' as const, content: t.content, summary: t.summary })),
  ].sort((a, b) => a.textOffset - b.textOffset);

  const text = streamingTokens;
  const segments: MessageSegment[] = [];
  let cursor = 0;

  for (const ins of allInsertions) {
    const offset = Math.min(ins.textOffset, text.length);
    if (offset > cursor) {
      segments.push({ type: 'text', content: text.slice(cursor, offset) });
    }
    if (ins.kind === 'tool') {
      const ev = eventMap.get(ins.toolId);
      segments.push({
        type: 'tool',
        toolId: ins.toolId,
        toolName: ev?.toolName || 'unknown',
        input: ev?.input,
        output: ev?.output,
        isError: ev?.isError,
      });
    } else {
      segments.push({
        type: 'thinking',
        content: ins.content,
        summary: ins.summary,
      });
    }
    cursor = offset;
  }

  if (cursor < text.length) {
    segments.push({ type: 'text', content: text.slice(cursor) });
  }

  return segments;
}

// Voice getters
export function getVoiceModeEnabled() { return voiceModeEnabled; }
export function getTranscriptionStatus() { return transcriptionStatus; }
export function getTranscriptionText() { return transcriptionText; }
export function getTranscriptionError() { return transcriptionError; }
export function getTranscriptionProsody() { return transcriptionProsody; }
export function clearTranscription() {
  transcriptionStatus = 'idle';
  transcriptionText = null;
  transcriptionError = null;
  transcriptionProsody = null;
}

// TTS getters
export function getTtsPlaying() { return ttsPlaying; }
export function getTtsAudioQueue() { return ttsAudioQueue; }
export function dequeueTtsAudio() {
  if (ttsAudioQueue.length === 0) return null;
  const [item, ...rest] = ttsAudioQueue;
  ttsAudioQueue = rest;
  return item;
}
export function setTtsPlaying(playing: boolean) { ttsPlaying = playing; }

// Context usage getters
export function getContextUsage() { return contextUsage; }
export function getCompactionNotice() { return compactionNotice; }

// Canvas getters & actions
export function getCanvases() { return canvases; }
export function getActiveCanvasId() { return activeCanvasId; }
export function setActiveCanvasId(id: string | null) { activeCanvasId = id; }
export function sendCanvasCreate(title: string, contentType: 'markdown' | 'code' | 'text' | 'html', language?: string, threadId?: string) {
  send({ type: 'canvas_create', title, contentType, language, threadId });
}
export function sendCanvasUpdate(canvasId: string, content: string) {
  send({ type: 'canvas_update', canvasId, content });
  // Optimistically update local store (server broadcasts to others via broadcastExcept)
  canvases = canvases.map(c =>
    c.id === canvasId
      ? { ...c, content, updated_at: new Date().toISOString() }
      : c
  );
}
export function sendCanvasUpdateTitle(canvasId: string, title: string) {
  send({ type: 'canvas_update_title', canvasId, title });
  canvases = canvases.map(c =>
    c.id === canvasId
      ? { ...c, title, updated_at: new Date().toISOString() }
      : c
  );
}
export function sendCanvasDelete(canvasId: string) {
  send({ type: 'canvas_delete', canvasId });
}

// Stop generation
export function sendStopGeneration() {
  send({ type: 'stop_generation' });
}
export function isStreaming() { return streamingMessageId !== null; }

// Rate limit
export function getRateLimitInfo() { return rateLimitInfo; }

// MCP control
export function sendMcpReconnect(serverName: string) {
  send({ type: 'mcp_reconnect', serverName });
}
export function sendMcpToggle(serverName: string, enabled: boolean) {
  send({ type: 'mcp_toggle', serverName, enabled });
}

// File rewind
export function sendRewindFiles(userMessageId: string, dryRun?: boolean) {
  send({ type: 'rewind_files', userMessageId, dryRun });
}
export function getRewindResult() { return rewindResult; }

// Command system
export function getCommandRegistry() { return commandRegistry; }
export function getLastCommandResult() { return lastCommandResult; }
export function clearCommandResult() { lastCommandResult = null; }
export function sendCommand(name: string, args?: string, threadId?: string) {
  send({ type: 'command', name, args, threadId });
}
