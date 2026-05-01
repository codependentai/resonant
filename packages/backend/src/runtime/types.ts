import type { McpServerInfo } from '@resonant/shared';
import type { RuntimeLifecycleContext } from '../runtime-lifecycle/types.js';

export type RuntimeProviderId = 'claude-code' | 'openai-codex' | 'openrouter';

export interface RuntimeCapabilities {
  subscription: boolean;
  byok: boolean;
  tools: boolean;
  nativeTools: boolean;
  mcp: boolean;
  rewind: boolean;
  thinking: boolean;
  autonomous: boolean;
  sessions: boolean;
  experimental?: boolean;
  planned?: boolean;
}

export interface RuntimeQuery {
  provider: RuntimeProviderId;
  model: string;
  prompt: string;
  identityPrompt?: string;
  systemPrompt?: string;
  cwd: string;
  threadId: string;
  sessionId?: string | null;
  isAutonomous?: boolean;
  lifecycleContext?: RuntimeLifecycleContext;
  maxTurns?: number;
  allowTools?: boolean;
  allowThinking?: boolean;
  persistSession?: boolean;
}

export type RuntimeEvent =
  | { type: 'text_delta'; text: string; fullText: string }
  | { type: 'thinking_delta'; content: string; summary: string }
  | { type: 'tool_use'; toolId: string; toolName: string; input?: string; textOffset?: number }
  | { type: 'tool_result'; toolId: string; output?: string; isError?: boolean }
  | { type: 'tool_progress'; toolId: string; toolName: string; elapsed: number }
  | { type: 'context_usage'; tokensUsed: number; contextWindow: number }
  | { type: 'compaction'; preTokens: number; message: string; isComplete: boolean; resetResponse?: boolean }
  | { type: 'rate_limit'; status: string; resetsAt?: number; rateLimitType?: string; utilization?: number }
  | { type: 'session'; sessionId: string }
  | { type: 'mcp_status'; servers: McpServerInfo[] }
  | { type: 'error'; message: string }
  | { type: 'done'; responseText?: string };

export interface RuntimeProvider {
  id: RuntimeProviderId;
  label: string;
  capabilities: RuntimeCapabilities;
  run(query: RuntimeQuery): AsyncGenerator<RuntimeEvent>;
  abort?(): boolean;
  getMcpStatus?(): McpServerInfo[];
  reconnectMcpServer?(name: string): Promise<{ success: boolean; error?: string }>;
  toggleMcpServer?(name: string, enabled: boolean): Promise<{ success: boolean; error?: string }>;
  rewindFiles?(userMessageId: string, opts?: { dryRun?: boolean }): Promise<{
    canRewind: boolean;
    filesChanged?: string[];
    insertions?: number;
    deletions?: number;
    error?: string;
  }>;
  listSessions?(limit?: number): Promise<unknown[]>;
}

export interface RuntimeSelection {
  provider: RuntimeProviderId;
  model: string;
}
