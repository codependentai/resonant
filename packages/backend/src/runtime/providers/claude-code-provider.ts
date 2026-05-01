import {
  AbortError,
  listSessions,
  query,
  type ListSessionsOptions,
  type McpServerConfig,
  type Options,
  type Query,
} from '@anthropic-ai/claude-agent-sdk';
import type { McpServerInfo } from '@resonant/shared';
import { join } from 'path';
import { RUNTIME_CAPABILITIES } from '../capabilities.js';
import type { RuntimeEvent, RuntimeProvider, RuntimeQuery } from '../types.js';
import { createHooks } from '../../services/hooks.js';

function extractThinkingSummary(text: string): string {
  const trimmed = text.replace(/^\s+/, '');
  const match = trimmed.match(/^(.+?(?:\.\s|!\s|\?\s|\n))/);
  if (match) {
    const sentence = match[1].trim();
    if (sentence.length <= 120) return sentence;
    return sentence.slice(0, 117) + '...';
  }
  if (trimmed.length <= 120) return trimmed;
  return trimmed.slice(0, 117) + '...';
}

export class ClaudeCodeProvider implements RuntimeProvider {
  readonly id = 'claude-code' as const;
  readonly label = 'Claude Code';
  readonly capabilities = RUNTIME_CAPABILITIES['claude-code'];

  private activeAbortController: AbortController | null = null;
  private activeQuery: Query | null = null;
  private cachedMcpStatus: McpServerInfo[] = [];

  constructor(
    private readonly mcpServers: Record<string, McpServerConfig>,
    private readonly agentCwd: string,
  ) {}

  getMcpStatus(): McpServerInfo[] {
    return this.cachedMcpStatus;
  }

  abort(): boolean {
    if (!this.activeAbortController) return false;
    this.activeAbortController.abort();
    return true;
  }

  async reconnectMcpServer(name: string): Promise<{ success: boolean; error?: string }> {
    if (!this.activeQuery) return { success: false, error: 'No active Claude Code session - will apply on next message' };
    try {
      await this.activeQuery.reconnectMcpServer(name);
      await this.refreshMcpStatus();
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async toggleMcpServer(name: string, enabled: boolean): Promise<{ success: boolean; error?: string }> {
    if (!this.activeQuery) return { success: false, error: 'No active Claude Code session - will apply on next message' };
    try {
      await this.activeQuery.toggleMcpServer(name, enabled);
      await this.refreshMcpStatus();
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async rewindFiles(
    userMessageId: string,
    opts?: { dryRun?: boolean },
  ): Promise<{ canRewind: boolean; filesChanged?: string[]; insertions?: number; deletions?: number; error?: string }> {
    if (!this.activeQuery) return { canRewind: false, error: 'No active Claude Code session' };
    try {
      return await this.activeQuery.rewindFiles(userMessageId, opts);
    } catch (err) {
      return { canRewind: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async listSessions(limit = 50): Promise<unknown[]> {
    try {
      const options: ListSessionsOptions = { dir: this.agentCwd, limit };
      return await listSessions(options);
    } catch (err) {
      console.error('Failed to list Claude Code sessions:', err);
      return [];
    }
  }

  async *run(runtimeQuery: RuntimeQuery): AsyncGenerator<RuntimeEvent> {
    let fullResponse = '';
    let currentThinkingAccum = '';

    const options: Options = {
      model: runtimeQuery.model,
      systemPrompt: runtimeQuery.systemPrompt
        ? runtimeQuery.systemPrompt
        : runtimeQuery.identityPrompt
          ? { type: 'preset', preset: 'claude_code', append: runtimeQuery.identityPrompt }
          : { type: 'preset', preset: 'claude_code' },
      cwd: runtimeQuery.cwd,
      permissionMode: runtimeQuery.allowTools === false ? 'plan' as any : 'bypassPermissions',
      allowDangerouslySkipPermissions: runtimeQuery.allowTools === false ? false : true,
      maxTurns: runtimeQuery.maxTurns ?? 30,
      includePartialMessages: true,
      persistSession: runtimeQuery.persistSession ?? true,
      ...(runtimeQuery.allowThinking === false ? {} : { thinking: { type: 'adaptive' as const } }),
    };

    if (runtimeQuery.lifecycleContext) {
      options.hooks = createHooks(runtimeQuery.lifecycleContext);
      options.plugins = [{ type: 'local' as const, path: join(runtimeQuery.cwd, '.claude').replace(/\\/g, '/') }];
      if (Object.keys(this.mcpServers).length > 0) options.mcpServers = this.mcpServers;
    }

    if (runtimeQuery.sessionId) options.resume = runtimeQuery.sessionId;
    if (runtimeQuery.allowTools === false) {
      (options as any).tools = [];
    }

    this.activeAbortController = new AbortController();
    options.abortController = this.activeAbortController;
    options.enableFileCheckpointing = runtimeQuery.allowTools !== false;

    const result = query({ prompt: runtimeQuery.prompt, options });
    this.activeQuery = result;

    result.mcpServerStatus()
      .then(statuses => {
        this.cachedMcpStatus = mapMcpStatus(statuses);
      })
      .catch(err => console.warn('Failed to get MCP status:', err instanceof Error ? err.message : err));

    try {
      for await (const msg of result) {
        if (msg && typeof msg === 'object' && 'session_id' in msg) {
          const sessionId = msg.session_id as string;
          if (sessionId) yield { type: 'session', sessionId };
        }

        if (!msg || typeof msg !== 'object' || !('type' in msg)) continue;
        const msgType = (msg as any).type;

        if (msgType === 'stream_event') {
          const streamEvent = (msg as any).event;
          if (streamEvent?.type === 'content_block_start' && streamEvent?.content_block?.type === 'thinking') {
            currentThinkingAccum = '';
          } else if (streamEvent?.type === 'content_block_delta' && streamEvent?.delta?.type === 'thinking_delta') {
            const thinkingText = streamEvent.delta.thinking || '';
            if (thinkingText) currentThinkingAccum += thinkingText;
          } else if (streamEvent?.type === 'content_block_stop' && currentThinkingAccum) {
            yield {
              type: 'thinking_delta',
              content: currentThinkingAccum,
              summary: extractThinkingSummary(currentThinkingAccum),
            };
            currentThinkingAccum = '';
          }
        } else if (msgType === 'assistant') {
          const assistantMsg = msg as any;
          if (assistantMsg.message?.content) {
            for (const block of assistantMsg.message.content) {
              if (block.type !== 'text' || !block.text) continue;
              fullResponse = fullResponse ? `${fullResponse}\n\n${block.text}` : block.text;
              yield { type: 'text_delta', text: block.text, fullText: fullResponse };
            }
          }
        } else if (msgType === 'result') {
          const resultMsg = msg as any;
          const usageEvent = normalizeUsage(resultMsg.usage, resultMsg.model_usage);
          if (usageEvent) yield usageEvent;
          if (resultMsg.subtype !== 'success') {
            console.error('Agent error:', resultMsg.subtype, resultMsg.errors);
          }
        } else if (msgType === 'system') {
          const systemMsg = msg as any;
          if (systemMsg.subtype === 'compact_boundary' && systemMsg.compact_metadata) {
            const preTokens = systemMsg.compact_metadata.pre_tokens || 0;
            yield {
              type: 'compaction',
              preTokens,
              message: `Context compacted (was ${Math.round(preTokens / 1000)}K tokens)`,
              isComplete: true,
              resetResponse: true,
            };
            fullResponse = '';
          }
        } else if (msgType === 'rate_limit_event') {
          const info = (msg as any).rate_limit_info;
          if (info && (info.status === 'rejected' || info.status === 'allowed_warning')) {
            yield {
              type: 'rate_limit',
              status: info.status,
              resetsAt: info.resetsAt,
              rateLimitType: info.rateLimitType,
              utilization: info.utilization,
            };
          }
        } else if (msgType === 'tool_progress') {
          const tp = msg as any;
          yield {
            type: 'tool_progress',
            toolId: tp.tool_use_id,
            toolName: tp.tool_name,
            elapsed: tp.elapsed_time_seconds,
          };
        }
      }
      yield { type: 'done', responseText: fullResponse };
    } catch (error) {
      if (error instanceof AbortError || (error instanceof Error && error.name === 'AbortError')) {
        console.log('[Agent] Generation stopped by user');
        yield { type: 'done', responseText: fullResponse };
      } else {
        throw error;
      }
    } finally {
      this.activeAbortController = null;
      this.activeQuery = null;
    }
  }

  private async refreshMcpStatus(): Promise<void> {
    if (!this.activeQuery) return;
    const statuses = await this.activeQuery.mcpServerStatus();
    this.cachedMcpStatus = mapMcpStatus(statuses);
  }
}

function mapMcpStatus(statuses: any[]): McpServerInfo[] {
  return statuses.map(s => ({
    name: s.name,
    status: s.status,
    error: s.error,
    toolCount: s.tools?.length ?? 0,
    tools: s.tools?.map((t: any) => ({ name: t.name, description: t.description })),
    scope: s.scope,
  }));
}

function normalizeUsage(usage: any, modelUsage: any): RuntimeEvent | null {
  let tokensUsed = 0;
  let contextWindow = 0;

  if (modelUsage) {
    for (const model of Object.values(modelUsage) as any[]) {
      if (model?.context_window) contextWindow = model.context_window;
      if (model?.input_tokens) tokensUsed = model.input_tokens + (model.output_tokens || 0);
    }
  } else if (usage?.input_tokens) {
    tokensUsed = usage.input_tokens + (usage.output_tokens || 0);
  }

  if (tokensUsed <= 0) return null;
  return { type: 'context_usage', tokensUsed, contextWindow };
}
