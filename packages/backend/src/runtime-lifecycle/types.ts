import type { Platform } from '@resonant/shared';
import type { ConnectionRegistry } from '../types.js';

export interface ToolInsertion {
  textOffset: number;
  toolId: string;
  toolName: string;
  input?: string;
  output?: string;
  isError?: boolean;
}

export interface RuntimeLifecycleContext {
  threadId: string;
  threadName: string;
  threadType: 'daily' | 'named';
  streamMsgId: string;
  isAutonomous: boolean;
  registry: ConnectionRegistry;
  sessionId: string | null;
  platform: Platform;
  platformContext?: string;
  toolInsertions: ToolInsertion[];
  getTextLength: () => number;
}

export type RuntimeLifecycleEventName =
  | 'before_prompt'
  | 'tool_requested'
  | 'tool_completed'
  | 'tool_failed'
  | 'before_compaction'
  | 'session_started'
  | 'session_ended'
  | 'notification';

export interface RuntimeLifecycleEvent {
  name: RuntimeLifecycleEventName;
  context: RuntimeLifecycleContext;
  provider?: string;
  payload?: Record<string, unknown>;
}
