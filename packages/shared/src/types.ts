// Database types — mirror the SQLite schema

export interface Thread {
  id: string;
  name: string;
  type: 'daily' | 'named';
  created_at: string;
  archived_at: string | null;
  current_session_id: string | null;
  session_type: 'v1' | 'v2';
  needs_reground: boolean;
  last_activity_at: string | null;
  unread_count: number;
  pinned_at: string | null;
}

export type Platform = 'web' | 'discord' | 'telegram' | 'api';

export interface Message {
  id: string;
  thread_id: string;
  sequence: number;
  role: 'companion' | 'user' | 'system';
  content: string;
  content_type: 'text' | 'image' | 'audio' | 'file';
  platform: Platform;
  metadata: Record<string, unknown> | null;
  reply_to_id: string | null;
  reply_to_preview: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  original_content: string | null;
  created_at: string;
  delivered_at: string | null;
  read_at: string | null;
}

export interface OutboundMessage {
  id: string;
  thread_id: string;
  message_id: string;
  status: 'pending' | 'delivered' | 'failed';
  push_sent: boolean;
  created_at: string;
}

export interface SessionRecord {
  id: string;
  thread_id: string;
  session_id: string;
  session_type: 'v1' | 'v2';
  started_at: string;
  ended_at: string | null;
  end_reason: 'compaction' | 'reaper' | 'daily_rotation' | 'error' | 'manual' | null;
  tokens_used: number | null;
  cost_usd: number | null;
  peak_memory_mb: number | null;
}

export interface AuditEntry {
  id: string;
  session_id: string;
  thread_id: string;
  tool_name: string;
  tool_input: string | null;
  tool_output: string | null;
  triggering_message_id: string | null;
  created_at: string;
}

export interface WebSession {
  id: string;
  token: string;
  created_at: string;
  expires_at: string;
}

export interface ConfigEntry {
  key: string;
  value: string;
}

export type PresenceStatus = 'active' | 'dormant' | 'waking' | 'offline';

export interface McpServerInfo {
  name: string;
  status: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled';
  error?: string;
  toolCount: number;
  tools?: { name: string; description?: string }[];
  scope?: string;
}

export interface OrchestratorTaskStatus {
  wakeType: string;
  label: string;
  cronExpr: string;
  enabled: boolean;
  status: 'scheduled' | 'stopped' | 'running';
  nextRun: string | null;
  category: 'wake' | 'checkin' | 'handoff' | 'failsafe' | 'routine';
}

export interface SystemStatus {
  uptime: number;
  memoryUsage: { rss: number; heapUsed: number; heapTotal: number };
  connections: number;
  userConnected: boolean;
  minutesSinceActivity: number;
  presence: PresenceStatus;
  agentProcessing: boolean;
  orchestratorTasks: OrchestratorTaskStatus[];
  mcpServers: McpServerInfo[];
  discord?: { connected: boolean; guilds: number; messagesProcessed: number; errors: number; deferredPending: number; username: string | null };
  telegram?: { connected: boolean; messagesProcessed: number; errors: number; restarts: number };
  queryQueue?: { processing: boolean; depth: number };
}

export interface Canvas {
  id: string;
  thread_id: string | null;
  title: string;
  content: string;
  content_type: 'markdown' | 'code' | 'text' | 'html';
  language: string | null;
  created_by: 'companion' | 'user';
  created_at: string;
  updated_at: string;
}

export type MessageSegment =
  | { type: 'text'; content: string }
  | { type: 'tool'; toolId: string; toolName: string; input?: string; output?: string; isError?: boolean }
  | { type: 'thinking'; content: string; summary: string };

export interface ThreadSummary {
  id: string;
  name: string;
  type: 'daily' | 'named';
  unread_count: number;
  last_activity_at: string | null;
  last_message_preview: string | null;
  pinned_at: string | null;
}

export interface SearchResult {
  message: Message;
  threadId: string;
  threadName: string;
  highlight: string;
}

export interface TriggerStatus {
  id: string;
  kind: 'impulse' | 'watcher';
  label: string;
  conditions: string;
  prompt: string | null;
  cooldown_minutes: number;
  status: 'pending' | 'waiting' | 'fired' | 'cancelled';
  last_fired_at: string | null;
  fire_count: number;
  created_at: string;
  fired_at: string | null;
}
