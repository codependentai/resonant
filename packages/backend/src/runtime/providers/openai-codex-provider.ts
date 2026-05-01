import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import crypto from 'crypto';
import { getResonantConfig } from '../../config.js';
import { getConfig } from '../../services/db.js';
import { buildProviderToolCallInstructions, executeInternalTool } from '../../tools/internal-registry.js';
import { RUNTIME_CAPABILITIES } from '../capabilities.js';
import type { RuntimeEvent, RuntimeProvider, RuntimeQuery } from '../types.js';

type CodexPermissionMode = 'read-only' | 'workspace-write' | 'danger-full-access';

interface CodexRunResult {
  text: string;
  usageEvents: RuntimeEvent[];
}

interface ParsedToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export class OpenAICodexProvider implements RuntimeProvider {
  readonly id = 'openai-codex' as const;
  readonly label = 'OpenAI Codex';
  readonly capabilities = RUNTIME_CAPABILITIES['openai-codex'];

  private activeProcess: ChildProcessWithoutNullStreams | null = null;

  abort(): boolean {
    if (!this.activeProcess) return false;
    this.activeProcess.kill();
    this.activeProcess = null;
    return true;
  }

  async *run(runtimeQuery: RuntimeQuery): AsyncGenerator<RuntimeEvent> {
    const systemParts = [
      'You are responding inside Resonant chat. Answer as the companion; do not edit files unless explicitly asked.',
      runtimeQuery.systemPrompt || runtimeQuery.identityPrompt || '',
      buildProviderToolCallInstructions(),
    ].filter(Boolean);

    const buildCodexPrompt = (body: string): string => [
      'Use the following companion identity and runtime notes as the highest-priority task context for this response.',
      '<runtime_context>',
      systemParts.join('\n\n'),
      '</runtime_context>',
      '',
      body,
    ].join('\n');

    let prompt = buildCodexPrompt(runtimeQuery.prompt);

    let finalText = '';
    const maxToolRounds = runtimeQuery.allowTools === false ? 0 : 3;

    for (let round = 0; round <= maxToolRounds; round++) {
      const result = await this.runCodexOnce(runtimeQuery, prompt);
      for (const event of result.usageEvents) yield event;

      const toolCall = parseToolCall(result.text);
      if (!toolCall) {
        finalText = stripToolCallBlocks(result.text).trim();
        if (finalText) yield { type: 'text_delta', text: finalText, fullText: finalText };
        yield { type: 'done', responseText: finalText };
        return;
      }

      const toolId = crypto.randomUUID();
      yield {
        type: 'tool_use',
        toolId,
        toolName: toolCall.name,
        input: JSON.stringify(toolCall.arguments),
        textOffset: 0,
      };

      const toolResult = await executeInternalTool(toolCall.name, toolCall.arguments, {
        threadId: runtimeQuery.threadId,
      });

      yield {
        type: 'tool_result',
        toolId,
        output: toolResult.text,
        isError: !toolResult.ok,
      };

      prompt = buildCodexPrompt([
        runtimeQuery.prompt,
        '',
        '<resonant_tool_result>',
        `name: ${toolCall.name}`,
        `ok: ${toolResult.ok}`,
        toolResult.text,
        toolResult.data ? JSON.stringify(toolResult.data).slice(0, 4000) : '',
        '</resonant_tool_result>',
        '',
        'Continue the answer to the user using the tool result. Do not repeat the tool-call block.',
      ].join('\n'));
    }

    finalText = '[Tool loop stopped after maximum Resonant tool rounds]';
    yield { type: 'error', message: finalText };
    yield { type: 'done', responseText: finalText };
  }

  private runCodexOnce(runtimeQuery: RuntimeQuery, prompt: string): Promise<CodexRunResult> {
    const cfg = getResonantConfig();
    const codexArgs = [
      'exec',
      '--json',
      '--ephemeral',
      '--ignore-user-config',
      ...buildCodexPermissionArgs(),
      '--skip-git-repo-check',
      '-m',
      runtimeQuery.model,
      '-C',
      runtimeQuery.cwd,
      '-',
    ];
    const command = process.platform === 'win32' ? 'cmd.exe' : 'codex';
    const args = process.platform === 'win32'
      ? ['/d', '/s', '/c', 'codex.cmd', ...codexArgs]
      : codexArgs;
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      RESONANT_PORT: String(cfg.server.port),
      RESONANT_THREAD: runtimeQuery.threadId,
    };
    if (process.env.RESONANT_CONFIG) childEnv.RESONANT_CONFIG = process.env.RESONANT_CONFIG;

    return new Promise<CodexRunResult>((resolve, reject) => {
      let responseText = '';
      let stdoutBuffer = '';
      let stderr = '';
      let codexErrorMessage = '';
      const usageEvents: RuntimeEvent[] = [];

      const child = spawn(command, args, {
        cwd: runtimeQuery.cwd,
        env: childEnv,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.activeProcess = child;

      const handleLine = (line: string): void => {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('{')) return;
        try {
          const event = JSON.parse(trimmed) as any;
          if (event.type === 'item.completed' && event.item?.type === 'agent_message' && typeof event.item.text === 'string') {
            responseText = responseText
              ? `${responseText}\n\n${event.item.text}`
              : event.item.text;
          } else if (event.type === 'turn.completed' && event.usage) {
            const inputTokens = Number(event.usage.input_tokens || 0);
            const outputTokens = Number(event.usage.output_tokens || 0);
            usageEvents.push({
              type: 'context_usage',
              tokensUsed: inputTokens + outputTokens,
              contextWindow: 0,
            });
          } else if (event.type === 'error' && typeof event.message === 'string') {
            codexErrorMessage = event.message;
          } else if (event.type === 'turn.failed' && typeof event.error?.message === 'string') {
            codexErrorMessage = event.error.message;
          }
        } catch {
          // Codex may interleave warning text with JSONL.
        }
      };

      child.stdout.on('data', chunk => {
        stdoutBuffer += chunk.toString();
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() ?? '';
        for (const line of lines) handleLine(line);
      });

      child.stderr.on('data', chunk => {
        stderr += chunk.toString();
      });

      child.on('error', err => {
        if (this.activeProcess === child) this.activeProcess = null;
        reject(err);
      });

      child.on('close', code => {
        if (stdoutBuffer) handleLine(stdoutBuffer);
        if (this.activeProcess === child) this.activeProcess = null;
        if (code === 0) {
          if (codexErrorMessage && !responseText) {
            reject(new Error(codexErrorMessage));
            return;
          }
          resolve({ text: responseText, usageEvents });
          return;
        }
        const detail = stderr.trim().split(/\r?\n/).slice(-3).join('\n');
        const errorDetail = codexErrorMessage || detail;
        reject(new Error(`Codex CLI exited with code ${code}${errorDetail ? `: ${errorDetail}` : ''}`));
      });

      child.stdin.end(prompt);
    });
  }
}

function resolveCodexPermissionMode(): CodexPermissionMode {
  const cfg = getResonantConfig();
  const configured = (
    getConfig('agent.openai_codex_permission') ||
    getConfig('agent.openai_codex.permission') ||
    process.env.OPENAI_CODEX_PERMISSION ||
    cfg.agent.openai_codex_permission ||
    cfg.agent.openai_codex.permission ||
    'workspace-write'
  ).trim();

  if (configured === 'read-only' || configured === 'workspace-write' || configured === 'danger-full-access') {
    return configured;
  }

  console.warn(`Unknown OpenAI Codex permission mode "${configured}", falling back to workspace-write`);
  return 'workspace-write';
}

function buildCodexPermissionArgs(): string[] {
  const mode = resolveCodexPermissionMode();
  if (mode === 'danger-full-access') return ['--dangerously-bypass-approvals-and-sandbox'];
  if (mode === 'read-only') return ['--sandbox', 'read-only'];
  return ['--full-auto', '--sandbox', 'workspace-write'];
}

function parseToolCall(text: string): ParsedToolCall | null {
  const match = text.match(/```resonant-tool-call\s*([\s\S]*?)```/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1].trim()) as { name?: unknown; arguments?: unknown };
    if (typeof parsed.name !== 'string') return null;
    return {
      name: parsed.name,
      arguments: parsed.arguments && typeof parsed.arguments === 'object'
        ? parsed.arguments as Record<string, unknown>
        : {},
    };
  } catch {
    return null;
  }
}

function stripToolCallBlocks(text: string): string {
  return text.replace(/```resonant-tool-call\s*[\s\S]*?```/g, '').trim();
}
