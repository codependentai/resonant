import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import type { McpServerInfo, MessageSegment } from '@resonant/shared';
import crypto from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getResonantConfig } from '../config.js';
import { loadCompanionIdentity } from '../identity/load.js';
import { describeIdentitySource, renderIdentityPrompt } from '../identity/render.js';
import type { IdentityProvider, LoadedCompanionIdentity } from '../identity/types.js';
import { buildOrientationContext } from '../runtime-lifecycle/context-builder.js';
import type { RuntimeLifecycleContext, ToolInsertion } from '../runtime-lifecycle/types.js';
import { RuntimeProviderManager } from '../runtime/provider-manager.js';
import { resolveRuntimeSelection } from '../runtime/selection.js';
import type { RuntimeEvent, RuntimeProvider, RuntimeProviderId } from '../runtime/types.js';
import type { PushService } from './push.js';
import {
  createMessage,
  createSessionRecord,
  endSessionRecord,
  getThread,
  updateThreadSession,
} from './db.js';
import { registry } from './ws.js';

let initialized = false;
let companionIdentityPrompt = '';
let companionIdentity: LoadedCompanionIdentity | null = null;
let AGENT_CWD = '';
const mcpServersFromConfig: Record<string, McpServerConfig> = {};
let runtimeProviders: RuntimeProviderManager | null = null;
let activeRuntimeProvider: RuntimeProvider | null = null;

let presenceStatus: 'active' | 'dormant' | 'waking' | 'offline' = 'offline';
let contextTokensUsed = 0;
let contextWindowSize = 0;
let cachedMcpStatus: McpServerInfo[] = [];

function ensureInit(): void {
  if (initialized) return;
  initialized = true;

  const config = getResonantConfig();
  AGENT_CWD = config.agent.cwd;

  companionIdentity = loadCompanionIdentity(config);
  companionIdentityPrompt = renderIdentityPrompt(companionIdentity, 'claude-code');
  console.log(`Loaded companion identity from: ${describeIdentitySource(companionIdentity)} (${companionIdentityPrompt.length} chars)`);

  const mcpJsonPath = config.agent.claude_code.mcp_json_path || config.agent.mcp_json_path;
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

  runtimeProviders = new RuntimeProviderManager(mcpServersFromConfig, AGENT_CWD);
}

function identityProviderForRuntime(provider: RuntimeProviderId): IdentityProvider {
  return provider;
}

function renderPromptForProvider(provider: RuntimeProviderId): string {
  ensureInit();
  if (!companionIdentity) return companionIdentityPrompt;
  return renderIdentityPrompt(companionIdentity, identityProviderForRuntime(provider));
}

const PRIORITIES = {
  web_interactive: 0,
  discord_owner: 1,
  discord_other: 2,
  autonomous: 3,
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
    if (!this.running && this.queue.length === 0) {
      this.running = true;
      try {
        return await execute();
      } finally {
        this.running = false;
        this.processNext();
      }
    }

    if (this.queue.length >= MAX_QUEUE_DEPTH) {
      const cfg = getResonantConfig();
      return `[${cfg.identity.companion_name} is busy - please try again in a moment]`;
    }

    return new Promise<string>((resolve, reject) => {
      this.queue.push({ priority, resolve, reject, execute, enqueuedAt: Date.now() });
      this.queue.sort((a, b) => a.priority - b.priority);
    });
  }

  private async processNext(): Promise<void> {
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

interface ThinkingInsertion {
  textOffset: number;
  content: string;
  summary: string;
}

function buildSegments(
  fullResponse: string,
  toolInsertions: ToolInsertion[],
  thinkingBlocks: ThinkingInsertion[] = [],
): MessageSegment[] {
  if (toolInsertions.length === 0 && thinkingBlocks.length === 0) return [];

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

  if (cursor < fullResponse.length) {
    segments.push({ type: 'text', content: fullResponse.slice(cursor) });
  }

  return segments;
}

function providerManager(): RuntimeProviderManager {
  ensureInit();
  if (!runtimeProviders) throw new Error('Runtime providers were not initialized');
  return runtimeProviders;
}

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
    const claudeStatus = providerManager().get('claude-code').getMcpStatus?.() || [];
    return claudeStatus.length > 0 ? claudeStatus : cachedMcpStatus;
  }

  getContextUsage(): { tokensUsed: number; contextWindow: number } {
    return { tokensUsed: contextTokensUsed, contextWindow: contextWindowSize };
  }

  stopGeneration(): boolean {
    if (!activeRuntimeProvider?.abort?.()) return false;
    registry.broadcast({ type: 'generation_stopped' });
    return true;
  }

  async reconnectMcpServer(name: string): Promise<{ success: boolean; error?: string }> {
    return providerManager().get('claude-code').reconnectMcpServer?.(name)
      || { success: false, error: 'Claude Code MCP controls are unavailable' };
  }

  async toggleMcpServer(name: string, enabled: boolean): Promise<{ success: boolean; error?: string }> {
    return providerManager().get('claude-code').toggleMcpServer?.(name, enabled)
      || { success: false, error: 'Claude Code MCP controls are unavailable' };
  }

  async rewindFiles(userMessageId: string, dryRun?: boolean): Promise<{
    canRewind: boolean;
    filesChanged?: string[];
    insertions?: number;
    deletions?: number;
    error?: string;
  }> {
    return providerManager().get('claude-code').rewindFiles?.(userMessageId, { dryRun })
      || { canRewind: false, error: 'Rewind is only supported by Claude Code' };
  }

  async listSessions(limit = 50): Promise<unknown[]> {
    const runtime = resolveRuntimeSelection(false, getResonantConfig());
    return providerManager().get(runtime.provider).listSessions?.(limit) || [];
  }

  async processMessage(
    threadId: string,
    content: string,
    threadMeta?: { name: string; type: 'daily' | 'named' },
    opts?: { platform?: 'web' | 'discord' | 'telegram' | 'api'; platformContext?: string },
  ): Promise<string> {
    const platform = opts?.platform || 'web';
    let priority: number;
    if (platform === 'web') {
      priority = PRIORITIES.web_interactive;
    } else if (platform === 'telegram') {
      priority = PRIORITIES.discord_owner;
    } else if (platform === 'discord') {
      priority = opts?.platformContext?.includes('owner') ? PRIORITIES.discord_owner : PRIORITIES.discord_other;
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
    return queryQueue.enqueue(PRIORITIES.autonomous, async () => this._processQuery(threadId, prompt, true));
  }

  private async _processQuery(
    threadId: string,
    content: string,
    isAutonomous = false,
    threadMeta?: { name: string; type: 'daily' | 'named' },
    platformOpts?: { platform?: 'web' | 'discord' | 'telegram' | 'api'; platformContext?: string },
  ): Promise<string> {
    ensureInit();
    const thread = getThread(threadId);
    if (!thread) throw new Error(`Thread ${threadId} not found`);

    const cfg = getResonantConfig();
    const streamMsgId = crypto.randomUUID();
    let fullResponse = '';
    let sessionId: string | null = null;
    const toolInsertions: ToolInsertion[] = [];
    const thinkingBlocks: ThinkingInsertion[] = [];
    const platform = platformOpts?.platform || 'web';

    const lifecycleContext: RuntimeLifecycleContext = {
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

    const isFirstMessage = !thread.current_session_id;
    const runtime = resolveRuntimeSelection(isAutonomous, cfg);
    const provider = providerManager().get(runtime.provider);
    activeRuntimeProvider = provider;

    registry.broadcast({ type: 'stream_start', messageId: streamMsgId, threadId });

    try {
      presenceStatus = 'active';
      registry.broadcast({ type: 'presence', status: 'active' });

      try {
        const threadFilePath = join(cfg.agent.cwd, '.resonant-thread');
        if (existsSync(cfg.agent.cwd)) writeFileSync(threadFilePath, threadId);
      } catch {}

      const orientation = await buildOrientationContext(lifecycleContext, isFirstMessage);
      const enrichedPrompt = `[Context]\n${orientation}\n[/Context]\n\n${content}`;

      for await (const event of provider.run({
        provider: runtime.provider,
        model: runtime.model,
        prompt: enrichedPrompt,
        identityPrompt: renderPromptForProvider(runtime.provider),
        cwd: AGENT_CWD,
        threadId,
        sessionId: thread.current_session_id,
        isAutonomous,
        lifecycleContext,
      })) {
        this.applyRuntimeEvent(
          event,
          streamMsgId,
          toolInsertions,
          thinkingBlocks,
          () => fullResponse.length,
          value => {
            fullResponse = value;
            lifecycleContext.getTextLength = () => fullResponse.length;
          },
          sid => {
            sessionId = sid;
            lifecycleContext.sessionId = sid;
          },
        );
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error('Agent query error:', errMsg, error);
      fullResponse = fullResponse || `[Agent error: ${errMsg}]`;
    } finally {
      activeRuntimeProvider = null;
      this.persistSessionTransition(threadId, thread.current_session_id, sessionId, thread.session_type);
      presenceStatus = 'dormant';
      registry.broadcast({ type: 'presence', status: 'dormant' });
    }

    const segments = buildSegments(fullResponse, toolInsertions, thinkingBlocks);
    const messageMetadata: Record<string, unknown> | undefined =
      segments.length > 0 ? { segments } : undefined;

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

    registry.broadcast({ type: 'stream_end', messageId: streamMsgId, final: companionMessage });

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

  private applyRuntimeEvent(
    event: RuntimeEvent,
    streamMsgId: string,
    toolInsertions: ToolInsertion[],
    thinkingBlocks: ThinkingInsertion[],
    getFullResponseLength: () => number,
    setFullResponse: (value: string) => void,
    setSessionId: (value: string) => void,
  ): void {
    switch (event.type) {
      case 'text_delta':
        setFullResponse(event.fullText);
        registry.broadcast({ type: 'stream_token', messageId: streamMsgId, token: event.fullText });
        break;
      case 'thinking_delta':
        thinkingBlocks.push({
          textOffset: getFullResponseLength(),
          content: event.content,
          summary: event.summary,
        });
        registry.broadcast({ type: 'thinking', content: event.content, summary: event.summary });
        break;
      case 'tool_use':
        toolInsertions.push({
          textOffset: event.textOffset ?? 0,
          toolId: event.toolId,
          toolName: event.toolName,
          input: event.input,
        });
        registry.broadcast({
          type: 'tool_use',
          toolId: event.toolId,
          toolName: event.toolName,
          input: event.input,
          isComplete: false,
          textOffset: event.textOffset,
        });
        break;
      case 'tool_result': {
        const insertion = toolInsertions.find(t => t.toolId === event.toolId);
        if (insertion) {
          insertion.output = event.output?.substring(0, 500);
          insertion.isError = event.isError;
        }
        registry.broadcast({
          type: 'tool_result',
          toolId: event.toolId,
          output: event.output,
          isError: event.isError,
        });
        break;
      }
      case 'tool_progress':
        registry.broadcast({
          type: 'tool_progress',
          toolId: event.toolId,
          toolName: event.toolName,
          elapsed: event.elapsed,
        });
        break;
      case 'context_usage':
        contextTokensUsed = event.tokensUsed;
        contextWindowSize = event.contextWindow;
        if (event.contextWindow > 0) {
          registry.broadcast({
            type: 'context_usage',
            percentage: Math.round((event.tokensUsed / event.contextWindow) * 100),
            tokensUsed: event.tokensUsed,
            contextWindow: event.contextWindow,
          });
        }
        break;
      case 'compaction':
        registry.broadcast({
          type: 'compaction_notice',
          preTokens: event.preTokens,
          message: event.message,
          isComplete: event.isComplete,
        });
        if (event.resetResponse) {
          setFullResponse('');
          toolInsertions.length = 0;
          thinkingBlocks.length = 0;
        }
        break;
      case 'rate_limit':
        registry.broadcast({
          type: 'rate_limit',
          status: event.status,
          resetsAt: event.resetsAt,
          rateLimitType: event.rateLimitType,
          utilization: event.utilization,
        });
        break;
      case 'session':
        setSessionId(event.sessionId);
        break;
      case 'mcp_status':
        cachedMcpStatus = event.servers;
        registry.broadcast({ type: 'mcp_status_updated', servers: event.servers });
        break;
      case 'error':
        console.warn(`[Runtime] ${event.message}`);
        break;
      case 'done':
        if (event.responseText !== undefined) setFullResponse(event.responseText);
        break;
    }
  }

  private persistSessionTransition(
    threadId: string,
    previousSessionId: string | null,
    sessionId: string | null,
    sessionType: 'v1' | 'v2',
  ): void {
    if (!sessionId) return;
    const now = new Date().toISOString();

    if (previousSessionId && previousSessionId !== sessionId) {
      try {
        endSessionRecord({ sessionId: previousSessionId, endedAt: now, endReason: 'resumed' });
      } catch {}
    }

    if (sessionId !== previousSessionId) {
      try {
        createSessionRecord({
          id: crypto.randomUUID(),
          threadId,
          sessionId,
          sessionType: sessionType || 'v2',
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
}
