import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import type { McpServerInfo, MessageSegment } from '@resonant/shared';
import crypto from 'crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { getResonantConfig } from '../config.js';
import { loadCompanionIdentity } from '../identity/load.js';
import { describeIdentitySource, renderIdentityPrompt } from '../identity/render.js';
import type { IdentityProvider, LoadedCompanionIdentity } from '../identity/types.js';
import { buildOrientationContext } from '../runtime-lifecycle/context-builder.js';
import type { RuntimeLifecycleContext, ToolInsertion } from '../runtime-lifecycle/types.js';
import { RuntimeProviderManager } from '../runtime/provider-manager.js';
import { resolveRuntimeSelection } from '../runtime/selection.js';
import type { RuntimeEvent, RuntimeProvider, RuntimeProviderId } from '../runtime/types.js';
import { fetchWebUrl } from '../tools/web-tools.js';
import type { PushService } from './push.js';
import {
  createMessage,
  createSessionRecord,
  endSessionRecord,
  getMessages,
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

const MAX_HISTORY_MESSAGES = 24;
const MAX_HISTORY_CHARS = 60_000;
const MAX_PREFLIGHT_PATHS = 4;
const MAX_PREFLIGHT_FILE_CHARS = 80_000;
const MAX_PREFLIGHT_DIR_ENTRIES = 120;
const MAX_PREFLIGHT_URLS = 3;
const MAX_PREFLIGHT_WEB_CHARS = 80_000;

function stripSegmentNoise(content: string): string {
  return content
    .replace(/\[No response\]/g, '')
    .trim();
}

function buildThreadHistoryContext(threadId: string, currentContent: string, provider: RuntimeProvider): string {
  if (provider.capabilities.sessions) return '';

  const messages = getMessages({ threadId, limit: MAX_HISTORY_MESSAGES + 1 });
  const previous = messages.filter((message, index) => {
    if (index !== messages.length - 1) return true;
    return !(message.role === 'user' && message.content === currentContent);
  });
  if (previous.length === 0) return '';

  const lines: string[] = [];
  let usedChars = 0;
  for (const message of previous) {
    if (message.content_type && message.content_type !== 'text') continue;
    const clean = stripSegmentNoise(message.content);
    if (!clean) continue;
    const role = message.role === 'companion' ? 'assistant' : message.role;
    const line = `[${role} | ${message.created_at}]\n${clean}`;
    usedChars += line.length;
    lines.push(line);
  }

  while (usedChars > MAX_HISTORY_CHARS && lines.length > 1) {
    const removed = lines.shift();
    usedChars -= removed?.length || 0;
  }

  if (lines.length === 0) return '';
  return [
    '[Recent conversation from this Resonant thread]',
    'Use this as chat history for continuity. The current user message appears after [/Context]; do not treat this transcript as a new request.',
    '',
    lines.join('\n\n---\n\n'),
  ].join('\n');
}

function isProbablyTextFile(path: string): boolean {
  const textExt = /\.(txt|md|mdx|json|jsonl|yaml|yml|toml|ini|env|ts|tsx|js|jsx|mjs|cjs|css|scss|html|svelte|py|ps1|bat|sh|sql|xml|csv|log)$/i;
  return textExt.test(path) || !/\.[a-z0-9]{2,8}$/i.test(path);
}

function cleanPathCandidate(candidate: string): string {
  return candidate
    .trim()
    .replace(/^file:\/\/\//i, '')
    .replace(/^["'`<]+|["'`>]+$/g, '')
    .replace(/[),.;:!?]+$/g, '')
    .trim();
}

function resolveExistingPath(candidate: string): string | null {
  let current = cleanPathCandidate(candidate);
  while (current.length > 0) {
    const normalized = resolve(current);
    if (existsSync(normalized)) return normalized;
    const lastSpace = current.lastIndexOf(' ');
    if (lastSpace < 0) break;
    current = cleanPathCandidate(current.slice(0, lastSpace));
  }
  return null;
}

function extractExistingLocalPaths(content: string): string[] {
  const paths = new Set<string>();
  const patterns = [
    /\]\((file:\/\/\/?[A-Za-z]:[\\/][^)]+|[A-Za-z]:[\\/][^)]+)\)/g,
    /["'`]([A-Za-z]:[\\/][^"'`\r\n]+)["'`]/g,
    /\b([A-Za-z]:[\\/][^\r\n]+)/g,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) && paths.size < MAX_PREFLIGHT_PATHS) {
      const resolved = resolveExistingPath(match[1]);
      if (resolved) paths.add(resolved);
    }
  }

  return Array.from(paths);
}

function buildLocalPathContext(content: string): string {
  const paths = extractExistingLocalPaths(content);
  if (paths.length === 0) return '';

  const sections: string[] = [];
  for (const path of paths) {
    try {
      const st = statSync(path);
      if (st.isDirectory()) {
        const entries = readdirSync(path, { withFileTypes: true })
          .slice(0, MAX_PREFLIGHT_DIR_ENTRIES)
          .map(entry => {
            const kind = entry.isDirectory() ? 'dir ' : entry.isFile() ? 'file' : 'other';
            return `${kind} ${entry.name}`;
          });
        sections.push([
          `Path: ${path}`,
          'Type: directory',
          `Entries${entries.length >= MAX_PREFLIGHT_DIR_ENTRIES ? ' (truncated)' : ''}:`,
          entries.join('\n') || '(empty)',
        ].join('\n'));
      } else if (st.isFile()) {
        if (!isProbablyTextFile(path)) {
          sections.push(`Path: ${path}\nType: file\nNote: likely binary; not preloaded as text.`);
          continue;
        }
        const fileContent = readFileSync(path, 'utf-8');
        const slice = fileContent.slice(0, MAX_PREFLIGHT_FILE_CHARS);
        sections.push([
          `Path: ${path}`,
          'Type: file',
          `Content${slice.length < fileContent.length ? ` (truncated at ${slice.length}/${fileContent.length} chars)` : ''}:`,
          slice,
        ].join('\n'));
      }
    } catch (err) {
      sections.push(`Path: ${path}\nError preloading path: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return [
    '[Local paths from the user message were inspected directly by Resonant before model runtime.]',
    'Use this path context when answering. Do not substitute memory for these files.',
    '',
    ...sections,
  ].join('\n');
}

function makePreflightToolInsertion(
  toolInsertions: ToolInsertion[],
  toolName: string,
  input: unknown,
  output: string,
  isError = false,
): void {
  const toolId = crypto.randomUUID();
  toolInsertions.push({
    textOffset: 0,
    toolId,
    toolName,
    input: JSON.stringify(input),
    output: output.substring(0, 500),
    isError,
  });
  registry.broadcast({
    type: 'tool_use',
    toolId,
    toolName,
    input: JSON.stringify(input),
    isComplete: false,
    textOffset: 0,
  });
  registry.broadcast({
    type: 'tool_result',
    toolId,
    output,
    isError,
  });
}

function extractWebUrls(content: string): string[] {
  const urls = new Set<string>();
  const pattern = /\bhttps?:\/\/[^\s<>"'`)\]]+/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) && urls.size < MAX_PREFLIGHT_URLS) {
    const cleaned = match[0].replace(/[.,;:!?]+$/g, '');
    try {
      const parsed = new URL(cleaned);
      urls.add(parsed.toString());
    } catch {
      // Ignore malformed URL-like text.
    }
  }
  return Array.from(urls);
}

async function buildWebUrlContext(content: string): Promise<string> {
  const urls = extractWebUrls(content);
  if (urls.length === 0) return '';

  const sections: string[] = [];
  for (const url of urls) {
    const result = await fetchWebUrl(url, { maxChars: MAX_PREFLIGHT_WEB_CHARS });
    sections.push([
      `Requested URL: ${url}`,
      result.ok ? 'Fetch: ok' : `Fetch: failed (${result.error || 'error'})`,
      result.text,
    ].join('\n'));
  }

  return [
    '[Web URLs from the user message were fetched directly by Resonant before model runtime.]',
    'Use this web context when answering. Do not substitute memory for these URLs.',
    '',
    ...sections,
  ].join('\n\n');
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
      const threadHistoryContext = buildThreadHistoryContext(threadId, content, provider);
      const localPathContext = buildLocalPathContext(content);
      const webUrlContext = await buildWebUrlContext(content);
      if (localPathContext) {
        makePreflightToolInsertion(
          toolInsertions,
          'file.read',
          { paths: extractExistingLocalPaths(content), source: 'preflight' },
          localPathContext,
        );
      }
      if (webUrlContext) {
        makePreflightToolInsertion(
          toolInsertions,
          'web.fetch',
          { urls: extractWebUrls(content), source: 'preflight' },
          webUrlContext,
          webUrlContext.includes('Fetch: failed'),
        );
      }
      const context = [orientation, threadHistoryContext, localPathContext, webUrlContext].filter(Boolean).join('\n\n');
      const enrichedPrompt = `[Context]\n${context}\n[/Context]\n\n${content}`;

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
