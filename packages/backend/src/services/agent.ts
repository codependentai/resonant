import { query, AbortError, listSessions, type Options, type Query, type McpServerConfig, type ListSessionsOptions } from '@anthropic-ai/claude-agent-sdk';
import type { McpServerInfo } from '@resonant/shared';
import { createMessage, updateThreadSession, getThread, updateThreadActivity, createSessionRecord, endSessionRecord } from './db.js';
import { registry } from './ws.js';
import { createHooks, buildOrientationContext, type HookContext, type ToolInsertion } from './hooks.js';
import type { MessageSegment } from '@resonant/shared';
import type { PushService } from './push.js';
import { getResonantConfig } from '../config.js';
import crypto from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';

// Lazy-init: config isn't available at import time — defer until first use
let _initialized = false;
let claudeMdContent = '';
let AGENT_CWD = '';
const mcpServersFromConfig: Record<string, McpServerConfig> = {};

function ensureInit() {
  if (_initialized) return;
  _initialized = true;
  const config = getResonantConfig();
  AGENT_CWD = config.agent.cwd;

  // Load CLAUDE.md
  const candidates = [
    config.agent.claude_md_path,
    join(AGENT_CWD, '.claude/CLAUDE.md'),
    join(AGENT_CWD, 'CLAUDE.md'),
  ];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    if (existsSync(candidate)) {
      claudeMdContent = readFileSync(candidate, 'utf-8');
      console.log(`Loaded CLAUDE.md from: ${candidate} (${claudeMdContent.length} chars)`);
      break;
    }
  }

  // Load .mcp.json
  const mcpJsonPath = config.agent.mcp_json_path;
  if (existsSync(mcpJsonPath)) {
    try {
      const mcpJson = JSON.parse(readFileSync(mcpJsonPath, 'utf-8'));
      if (mcpJson.mcpServers) {
        for (const [name, mcpCfg] of Object.entries(mcpJson.mcpServers) as [string, any][]) {
          if (mcpCfg.type === 'url' || mcpCfg.type === 'http') {
            mcpServersFromConfig[name] = { type: 'http', url: mcpCfg.url, headers: mcpCfg.headers };
          } else if (mcpCfg.type === 'sse') {
            mcpServersFromConfig[name] = { type: 'sse', url: mcpCfg.url, headers: mcpCfg.headers };
          } else if (!mcpCfg.type || mcpCfg.type === 'stdio') {
            mcpServersFromConfig[name] = { command: mcpCfg.command, args: mcpCfg.args, env: mcpCfg.env };
          }
        }
        console.log(`Loaded ${Object.keys(mcpServersFromConfig).length} MCP servers from .mcp.json: ${Object.keys(mcpServersFromConfig).join(', ')}`);
      }
    } catch (err) {
      console.warn('Failed to load .mcp.json:', err instanceof Error ? err.message : err);
    }
  }
}

// Presence state
let presenceStatus: 'active' | 'dormant' | 'waking' | 'offline' = 'offline';

// Context window tracking
let contextTokensUsed = 0;
let contextWindowSize = 0;

// Active query tracking (for abort, MCP control, rewind)
let activeAbortController: AbortController | null = null;
let activeQuery: Query | null = null;

// ---------------------------------------------------------------------------
// QueryQueue — priority-based queue replacing boolean queryLock
// Agent SDK V1 can only run one query at a time, so we queue excess requests
// ---------------------------------------------------------------------------

const PRIORITIES = {
  web_interactive: 0,    // Owner typing in UI
  discord_owner: 1,      // Owner on Discord
  discord_other: 2,      // Other users
  autonomous: 3,         // Orchestrator wakes
} as const;

const MAX_QUEUE_DEPTH = 5;
const QUEUE_TIMEOUT_MS = 90_000;

interface QueueEntry {
  priority: number;
  resolve: (value: string) => void;
  reject: (reason: Error) => void;
  execute: () => Promise<string>;
  enqueuedAt: number;
}

class QueryQueue {
  private queue: QueueEntry[] = [];
  private running = false;

  get isProcessing(): boolean {
    return this.running;
  }

  get depth(): number {
    return this.queue.length;
  }

  async enqueue(priority: number, execute: () => Promise<string>): Promise<string> {
    // If idle, run immediately
    if (!this.running && this.queue.length === 0) {
      this.running = true;
      try {
        return await execute();
      } finally {
        this.running = false;
        this.processNext();
      }
    }

    // Queue is full — reject
    if (this.queue.length >= MAX_QUEUE_DEPTH) {
      const cfg = getResonantConfig();
      return `[${cfg.identity.companion_name} is busy — please try again in a moment]`;
    }

    // Enqueue with priority
    return new Promise<string>((resolve, reject) => {
      this.queue.push({ priority, resolve, reject, execute, enqueuedAt: Date.now() });
      // Sort by priority (lower number = higher priority)
      this.queue.sort((a, b) => a.priority - b.priority);
    });
  }

  private async processNext(): Promise<void> {
    // Prune timed-out entries
    const now = Date.now();
    this.queue = this.queue.filter(entry => {
      if (now - entry.enqueuedAt > QUEUE_TIMEOUT_MS) {
        entry.resolve('[Request timed out in queue]');
        return false;
      }
      return true;
    });

    if (this.queue.length === 0) return;

    const next = this.queue.shift()!;
    this.running = true;

    try {
      const result = await next.execute();
      next.resolve(result);
    } catch (err) {
      next.reject(err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.running = false;
      this.processNext();
    }
  }
}

const queryQueue = new QueryQueue();

// Extract a short summary from thinking text (first sentence, capped at ~120 chars)
function extractThinkingSummary(text: string): string {
  const trimmed = text.replace(/^\s+/, '');
  // Find first sentence boundary
  const match = trimmed.match(/^(.+?(?:\.\s|!\s|\?\s|\n))/);
  if (match) {
    const sentence = match[1].trim();
    if (sentence.length <= 120) return sentence;
    return sentence.slice(0, 117) + '...';
  }
  // No sentence boundary found — take first 120 chars
  if (trimmed.length <= 120) return trimmed;
  return trimmed.slice(0, 117) + '...';
}

interface ThinkingInsertion {
  textOffset: number;
  content: string;
  summary: string;
}

// Build interleaved text/tool/thinking segments from response text + insertions
function buildSegments(fullResponse: string, toolInsertions: ToolInsertion[], thinkingBlocks: ThinkingInsertion[] = []): MessageSegment[] {
  if (toolInsertions.length === 0 && thinkingBlocks.length === 0) return [];

  // Merge all insertions into one sorted list
  type Insertion = { textOffset: number } & (
    | { kind: 'tool'; data: ToolInsertion }
    | { kind: 'thinking'; data: ThinkingInsertion }
  );

  const allInsertions: Insertion[] = [
    ...toolInsertions.map(t => ({ textOffset: t.textOffset, kind: 'tool' as const, data: t })),
    ...thinkingBlocks.map(t => ({ textOffset: t.textOffset, kind: 'thinking' as const, data: t })),
  ].sort((a, b) => a.textOffset - b.textOffset);

  const segments: MessageSegment[] = [];
  let cursor = 0;

  for (const ins of allInsertions) {
    const offset = Math.min(ins.textOffset, fullResponse.length);
    if (offset > cursor) {
      segments.push({ type: 'text', content: fullResponse.slice(cursor, offset) });
    }
    if (ins.kind === 'tool') {
      segments.push({
        type: 'tool',
        toolId: ins.data.toolId,
        toolName: ins.data.toolName,
        input: ins.data.input,
        output: ins.data.output,
        isError: ins.data.isError,
      });
    } else {
      segments.push({
        type: 'thinking',
        content: ins.data.content,
        summary: ins.data.summary,
      });
    }
    cursor = offset;
  }

  // Trailing text after last insertion
  if (cursor < fullResponse.length) {
    segments.push({ type: 'text', content: fullResponse.slice(cursor) });
  }

  return segments;
}

// Cached MCP server status (refreshed on each query)
let cachedMcpStatus: McpServerInfo[] = [];

export class AgentService {
  private pushService: PushService | null = null;

  setPushService(service: PushService): void {
    this.pushService = service;
  }

  getPresenceStatus(): 'active' | 'dormant' | 'waking' | 'offline' {
    return presenceStatus;
  }

  isProcessing(): boolean {
    return queryQueue.isProcessing;
  }

  getQueueDepth(): number {
    return queryQueue.depth;
  }

  getMcpStatus(): McpServerInfo[] {
    return cachedMcpStatus;
  }

  getContextUsage(): { tokensUsed: number; contextWindow: number } {
    return { tokensUsed: contextTokensUsed, contextWindow: contextWindowSize };
  }

  stopGeneration(): boolean {
    if (activeAbortController) {
      activeAbortController.abort();
      return true;
    }
    return false;
  }

  async reconnectMcpServer(name: string): Promise<{ success: boolean; error?: string }> {
    if (!activeQuery) {
      return { success: false, error: 'No active session — will apply on next message' };
    }
    try {
      await activeQuery.reconnectMcpServer(name);
      // Refresh cached status
      const statuses = await activeQuery.mcpServerStatus();
      cachedMcpStatus = statuses.map(s => ({
        name: s.name, status: s.status, error: s.error,
        toolCount: s.tools?.length ?? 0,
        tools: s.tools?.map(t => ({ name: t.name, description: t.description })),
        scope: s.scope,
      }));
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async toggleMcpServer(name: string, enabled: boolean): Promise<{ success: boolean; error?: string }> {
    if (!activeQuery) {
      return { success: false, error: 'No active session — will apply on next message' };
    }
    try {
      await activeQuery.toggleMcpServer(name, enabled);
      // Refresh cached status
      const statuses = await activeQuery.mcpServerStatus();
      cachedMcpStatus = statuses.map(s => ({
        name: s.name, status: s.status, error: s.error,
        toolCount: s.tools?.length ?? 0,
        tools: s.tools?.map(t => ({ name: t.name, description: t.description })),
        scope: s.scope,
      }));
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async rewindFiles(userMessageId: string, dryRun?: boolean): Promise<{ canRewind: boolean; filesChanged?: string[]; insertions?: number; deletions?: number; error?: string }> {
    if (!activeQuery) {
      return { canRewind: false, error: 'No active session' };
    }
    try {
      return await activeQuery.rewindFiles(userMessageId, { dryRun });
    } catch (err) {
      return { canRewind: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async listSessions(limit = 50): Promise<unknown[]> {
    ensureInit();
    try {
      const sessions = await listSessions({ dir: AGENT_CWD, limit });
      return sessions;
    } catch (err) {
      console.error('Failed to list sessions:', err);
      return [];
    }
  }

  async processMessage(threadId: string, content: string, threadMeta?: { name: string; type: 'daily' | 'named' }, opts?: {
    platform?: 'web' | 'discord' | 'telegram' | 'api';
    platformContext?: string;
  }): Promise<string> {
    // Determine priority based on platform
    const platform = opts?.platform || 'web';
    let priority: number;
    if (platform === 'web') {
      priority = PRIORITIES.web_interactive;
    } else if (platform === 'telegram') {
      // Telegram is owner-only — always high priority
      priority = PRIORITIES.discord_owner;
    } else if (platform === 'discord') {
      // Check if it's the owner by inspecting platformContext
      // Discord messages from the owner get higher priority
      const isOwner = opts?.platformContext?.includes('owner');
      priority = isOwner ? PRIORITIES.discord_owner : PRIORITIES.discord_other;
    } else {
      priority = PRIORITIES.web_interactive;
    }

    return queryQueue.enqueue(priority, async () => {
      presenceStatus = 'waking';
      registry.broadcast({ type: 'presence', status: 'waking' });
      return this._processQuery(threadId, content, false, threadMeta, opts);
    });
  }

  async processAutonomous(threadId: string, prompt: string): Promise<string> {
    return queryQueue.enqueue(PRIORITIES.autonomous, async () => {
      return this._processQuery(threadId, prompt, true);
    });
  }

  private async _processQuery(threadId: string, content: string, isAutonomous = false, threadMeta?: { name: string; type: 'daily' | 'named' }, platformOpts?: { platform?: 'web' | 'discord' | 'telegram' | 'api'; platformContext?: string }): Promise<string> {
    ensureInit();
    const thread = getThread(threadId);
    if (!thread) throw new Error(`Thread ${threadId} not found`);

    const cfg = getResonantConfig();

    // Stream message placeholder
    const streamMsgId = crypto.randomUUID();

    // Response and tool tracking (declared early so hookContext can reference)
    let fullResponse = '';
    const toolInsertions: ToolInsertion[] = [];
    const thinkingBlocks: ThinkingInsertion[] = [];
    let currentThinkingAccum = '';

    // Build hook context
    const platform = platformOpts?.platform || 'web';
    const hookContext: HookContext = {
      threadId,
      threadName: threadMeta?.name ?? thread.name,
      threadType: threadMeta?.type ?? thread.type,
      streamMsgId,
      isAutonomous,
      registry,
      sessionId: thread.current_session_id || null,
      platform,
      platformContext: platformOpts?.platformContext,
      toolInsertions,
      getTextLength: () => fullResponse.length,
    };

    // First message of this session — include static orientation content (tools, skills, vault)
    const isFirstMessage = !thread.current_session_id;

    // Build query options — V1 API (full config support)
    // Two-tier model: autonomous wakes use cheaper model (configurable)
    // Interactive queries use primary model (configurable)
    const model = isAutonomous
      ? cfg.agent.model_autonomous
      : (cfg.agent.model || process.env.AGENT_MODEL || 'claude-sonnet-4-6');
    const options: Options = {
      model,
      systemPrompt: claudeMdContent
        ? { type: 'preset', preset: 'claude_code', append: claudeMdContent }
        : { type: 'preset', preset: 'claude_code' },
      cwd: AGENT_CWD,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      maxTurns: 30,

      includePartialMessages: true,
      thinking: { type: 'adaptive' },
      hooks: createHooks(hookContext),
      // Explicitly pass MCP servers — SDK isolation mode doesn't auto-discover .mcp.json
      ...(Object.keys(mcpServersFromConfig).length > 0 && { mcpServers: mcpServersFromConfig }),
    };

    // Resume existing session if available
    if (thread.current_session_id) {
      options.resume = thread.current_session_id;
    }

    registry.broadcast({
      type: 'stream_start',
      messageId: streamMsgId,
      threadId,
    });

    let sessionId: string | null = null;

    try {
      presenceStatus = 'active';
      registry.broadcast({ type: 'presence', status: 'active' });

      // Write thread ID for CLI tool integration (only if cwd dir exists)
      try {
        const threadFilePath = join(cfg.agent.cwd, '.resonant-thread');
        if (existsSync(cfg.agent.cwd)) {
          writeFileSync(threadFilePath, threadId);
        }
      } catch {}

      // Build orientation context (thread, time, gap, status, vault)
      // Prepended to prompt because SessionStart hooks don't fire in V1 query()
      // Static content (CHAT TOOLS, skills, vault path) only on first message of session
      const orientation = await buildOrientationContext(hookContext, isFirstMessage);
      const enrichedPrompt = `[Context]\n${orientation}\n[/Context]\n\n${content}`;

      // Abort controller for stop_generation support
      activeAbortController = new AbortController();
      options.abortController = activeAbortController;

      // File checkpointing for rewind support
      options.enableFileCheckpointing = true;

      // V1 query — single params object with prompt and options
      const result = query({ prompt: enrichedPrompt, options });
      activeQuery = result;

      // Refresh MCP server status (non-blocking — caches for settings panel)
      result.mcpServerStatus().then(statuses => {
        cachedMcpStatus = statuses.map(s => ({
          name: s.name,
          status: s.status,
          error: s.error,
          toolCount: s.tools?.length ?? 0,
          tools: s.tools?.map(t => ({ name: t.name, description: t.description })),
          scope: s.scope,
        }));
        console.log(`MCP status refreshed: ${cachedMcpStatus.length} servers`);
      }).catch(err => {
        console.warn('Failed to get MCP status:', err instanceof Error ? err.message : err);
      });

      // Simplified stream loop — hooks handle tool activity, audit, images
      // Inner try/catch for AbortError (stop_generation)
      try {
      for await (const msg of result) {
        // Capture session ID from any message
        if (msg && typeof msg === 'object' && 'session_id' in msg) {
          const newSessionId = msg.session_id as string;
          if (newSessionId && newSessionId !== sessionId) {
            sessionId = newSessionId;
            // Update hook context so hooks log the correct session
            hookContext.sessionId = sessionId;
          }
        }

        if (!msg || typeof msg !== 'object' || !('type' in msg)) continue;

        const msgType = (msg as any).type;

        // Capture thinking from raw stream events (SDK strips them from assistant messages)
        if (msgType === 'stream_event') {
          const streamEvent = (msg as any).event;
          if (streamEvent?.type === 'content_block_start' && streamEvent?.content_block?.type === 'thinking') {
            currentThinkingAccum = '';
          } else if (streamEvent?.type === 'content_block_delta' && streamEvent?.delta?.type === 'thinking_delta') {
            const thinkingText = streamEvent.delta.thinking || '';
            if (thinkingText) {
              currentThinkingAccum += thinkingText;
            }
          } else if (streamEvent?.type === 'content_block_stop' && currentThinkingAccum) {
            const summary = extractThinkingSummary(currentThinkingAccum);
            thinkingBlocks.push({
              textOffset: fullResponse.length,
              content: currentThinkingAccum,
              summary,
            });
            registry.broadcast({ type: 'thinking', content: currentThinkingAccum, summary });
            currentThinkingAccum = '';
          }
        }

        if (msgType === 'assistant') {
          const assistantMsg = msg as any;
          if (assistantMsg.message?.content) {
            for (const block of assistantMsg.message.content) {
              if (block.type === 'text' && block.text) {
                if (fullResponse) fullResponse += '\n\n' + block.text;
                else fullResponse = block.text;

                registry.broadcast({
                  type: 'stream_token',
                  messageId: streamMsgId,
                  token: fullResponse,
                });
              }
              // Thinking blocks are captured from stream_event, not here (avoids duplicates)
            }
          }
        } else if (msgType === 'result') {
          const resultMsg = msg as any;

          // Extract context window usage from result
          if (resultMsg.usage || resultMsg.model_usage) {
            const usage = resultMsg.usage || {};
            const modelUsage = resultMsg.model_usage;

            // Get context window size from model usage if available
            if (modelUsage) {
              for (const model of Object.values(modelUsage) as any[]) {
                if (model?.context_window) {
                  contextWindowSize = model.context_window;
                }
                if (model?.input_tokens) {
                  contextTokensUsed = model.input_tokens + (model.output_tokens || 0);
                }
              }
            } else if (usage.input_tokens) {
              contextTokensUsed = usage.input_tokens + (usage.output_tokens || 0);
            }

            if (contextWindowSize > 0 && contextTokensUsed > 0) {
              const percentage = Math.round((contextTokensUsed / contextWindowSize) * 100);
              console.log(`Context usage: ${contextTokensUsed} / ${contextWindowSize} (${percentage}%)`);
              registry.broadcast({
                type: 'context_usage',
                percentage,
                tokensUsed: contextTokensUsed,
                contextWindow: contextWindowSize,
              });
            }
          }

          if (resultMsg.subtype !== 'success') {
            console.error('Agent error:', resultMsg.subtype, resultMsg.errors);
          }
        } else if (msgType === 'system') {
          const systemMsg = msg as any;
          // Detect compaction boundary
          if (systemMsg.subtype === 'compact_boundary' && systemMsg.compact_metadata) {
            const preTokens = systemMsg.compact_metadata.pre_tokens || contextTokensUsed;
            console.log(`[Compaction] Context compacted. Pre-tokens: ${preTokens}`);
            registry.broadcast({
              type: 'compaction_notice',
              preTokens,
              message: `Context compacted (was ${Math.round(preTokens / 1000)}K tokens)`,
              isComplete: true,
            });
            // Reset tracking — new context window after compaction
            contextTokensUsed = 0;
            // Reset response buffer — pre-compaction text was incomplete and post-compaction
            // re-grounding monologue must not leak into Discord/phone replies
            if (fullResponse) {
              console.log(`[Compaction] Resetting fullResponse (was ${fullResponse.length} chars, platform: ${platform})`);
              fullResponse = '';
            }
            toolInsertions.length = 0;
            thinkingBlocks.length = 0;
          } else if (systemMsg.status === 'compacting') {
            console.log('[Compaction] Compacting in progress...');
          }
        } else if (msgType === 'rate_limit_event') {
          const rle = msg as any;
          const info = rle.rate_limit_info;
          if (info && (info.status === 'rejected' || info.status === 'allowed_warning')) {
            registry.broadcast({
              type: 'rate_limit',
              status: info.status,
              resetsAt: info.resetsAt,
              rateLimitType: info.rateLimitType,
              utilization: info.utilization,
            });
            console.log(`[Agent] Rate limit: ${info.status}, type: ${info.rateLimitType}, resets: ${info.resetsAt}`);
          }
        } else if (msgType === 'tool_progress') {
          const tp = msg as any;
          registry.broadcast({
            type: 'tool_progress',
            toolId: tp.tool_use_id,
            toolName: tp.tool_name,
            elapsed: tp.elapsed_time_seconds,
          });
        }
      }
      } catch (abortErr) {
        if (abortErr instanceof AbortError || (abortErr instanceof Error && abortErr.name === 'AbortError')) {
          console.log('[Agent] Generation stopped by user');
          registry.broadcast({ type: 'generation_stopped' });
        } else {
          throw abortErr; // Re-throw non-abort errors to outer catch
        }
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error('Agent query error:', errMsg, error);
      fullResponse = fullResponse || `[Agent error: ${errMsg}]`;
    } finally {
      // Clean up active query tracking
      activeAbortController = null;
      activeQuery = null;
      // Track session transition and update for future resume
      if (sessionId) {
        const previousSessionId = thread.current_session_id;
        const now = new Date().toISOString();

        // End the previous session record (if tracked)
        if (previousSessionId && previousSessionId !== sessionId) {
          try {
            endSessionRecord({ sessionId: previousSessionId, endedAt: now, endReason: 'resumed' });
          } catch { /* Previous session may not have a record yet */ }
        }

        // Create a record for the new session
        if (sessionId !== previousSessionId) {
          try {
            createSessionRecord({
              id: crypto.randomUUID(),
              threadId,
              sessionId,
              sessionType: (thread.session_type as 'v1' | 'v2') || 'v2',
              startedAt: now,
            });
          } catch (err) {
            if (!(err instanceof Error && err.message.includes('UNIQUE'))) {
              console.warn('Failed to create session record:', err);
            }
          }
        }

        updateThreadSession(threadId, sessionId);
      }
      presenceStatus = 'dormant';
      registry.broadcast({ type: 'presence', status: 'dormant' });
    }

    // Build segments for interleaved tool/thinking display
    const segments = buildSegments(fullResponse, toolInsertions, thinkingBlocks);
    const messageMetadata: Record<string, unknown> | undefined =
      segments.length > 0 ? { segments } : undefined;

    // Store final message
    const companionMessage = createMessage({
      id: streamMsgId,
      threadId,
      role: 'companion',
      content: fullResponse || '[No response]',
      contentType: 'text',
      platform,
      metadata: messageMetadata,
      createdAt: new Date().toISOString(),
    });

    // End stream
    registry.broadcast({
      type: 'stream_end',
      messageId: streamMsgId,
      final: companionMessage,
    });

    // Push notification for offline user
    if (this.pushService && fullResponse) {
      const preview = fullResponse.substring(0, 120).replace(/\n/g, ' ');
      this.pushService.sendIfOffline({
        title: isAutonomous ? `${cfg.identity.companion_name} (autonomous)` : cfg.identity.companion_name,
        body: preview,
        threadId,
        tag: `msg-${streamMsgId}`,
        url: '/chat',
      }).catch(err => console.error('Push error:', err));
    }

    return fullResponse;
  }
}
