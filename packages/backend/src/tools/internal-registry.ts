import crypto from 'crypto';
import {
  cancelTimer,
  createTimer,
  getThread,
  listPendingTimers,
} from '../services/db.js';
import { FILE_INTERNAL_TOOLS } from './file-tools.js';
import { WEB_INTERNAL_TOOLS } from './web-tools.js';

export type InternalToolPermission = 'read' | 'write' | 'external';

export interface JsonSchema {
  type: 'object';
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface InternalToolContext {
  threadId?: string;
}

export interface InternalToolResult {
  ok: boolean;
  text: string;
  data?: unknown;
  error?: string;
}

export type InternalToolHandler = (
  args: Record<string, unknown>,
  context: InternalToolContext,
) => Promise<InternalToolResult> | InternalToolResult;

export interface InternalToolDefinition {
  name: string;
  title: string;
  description: string;
  schema: JsonSchema;
  permission: InternalToolPermission;
  annotations?: Record<string, unknown>;
  timeoutMs: number;
  cliExamples: string[];
  handler?: InternalToolHandler;
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${key} is required`);
  }
  return value.trim();
}

function resolveThreadId(args: Record<string, unknown>, context: InternalToolContext): string {
  const explicit = typeof args.threadId === 'string' && args.threadId.trim()
    ? args.threadId.trim()
    : context.threadId;
  if (!explicit) throw new Error('threadId is required');
  if (!getThread(explicit)) throw new Error(`Thread not found: ${explicit}`);
  return explicit;
}

function formatTimers(): InternalToolResult {
  const timers = listPendingTimers();
  if (timers.length === 0) {
    return { ok: true, text: 'No pending timers.', data: { timers } };
  }
  const lines = timers.map(t => {
    const context = t.context ? ` - ${t.context}` : '';
    return `- ${t.id}: ${t.label} at ${t.fire_at}${context}`;
  });
  return { ok: true, text: `Pending timers:\n${lines.join('\n')}`, data: { timers } };
}

export const INTERNAL_TOOLS: InternalToolDefinition[] = [
  {
    name: 'timer.list',
    title: 'List Timers',
    description: 'List pending Resonant timers and reminders.',
    permission: 'read',
    timeoutMs: 2000,
    schema: { type: 'object', properties: {}, additionalProperties: false },
    cliExamples: ['timer list'],
    handler: () => formatTimers(),
  },
  {
    name: 'timer.create',
    title: 'Create Timer',
    description: 'Create a contextual reminder in the current thread.',
    permission: 'write',
    timeoutMs: 2000,
    schema: {
      type: 'object',
      properties: {
        label: { type: 'string' },
        context: { type: 'string' },
        fireAt: { type: 'string', description: 'ISO timestamp or date parseable by JavaScript Date' },
        threadId: { type: 'string' },
        prompt: { type: 'string' },
      },
      required: ['label', 'fireAt'],
      additionalProperties: false,
    },
    cliExamples: ['timer create "label" "context" "2026-04-25T18:00:00+01:00"'],
    handler: (args, context) => {
      const label = requireString(args, 'label');
      const fireAtRaw = requireString(args, 'fireAt');
      const fireDate = new Date(fireAtRaw);
      if (Number.isNaN(fireDate.getTime())) throw new Error('fireAt must be a valid date');
      const threadId = resolveThreadId(args, context);
      const timer = createTimer({
        id: crypto.randomUUID(),
        label,
        context: typeof args.context === 'string' ? args.context : undefined,
        fireAt: fireDate.toISOString(),
        threadId,
        prompt: typeof args.prompt === 'string' ? args.prompt : undefined,
        createdAt: new Date().toISOString(),
      });
      return { ok: true, text: `Timer created: ${timer.id} (${timer.label})`, data: { timer } };
    },
  },
  {
    name: 'timer.cancel',
    title: 'Cancel Timer',
    description: 'Cancel a pending timer by ID.',
    permission: 'write',
    timeoutMs: 2000,
    schema: {
      type: 'object',
      properties: { timerId: { type: 'string' } },
      required: ['timerId'],
      additionalProperties: false,
    },
    cliExamples: ['timer cancel TIMER_ID'],
    handler: (args) => {
      const timerId = requireString(args, 'timerId');
      const cancelled = cancelTimer(timerId);
      if (!cancelled) {
        return { ok: false, text: `Timer not found or already fired/cancelled: ${timerId}`, error: 'timer_not_found' };
      }
      return { ok: true, text: `Timer cancelled: ${timerId}`, data: { timerId } };
    },
  },
  {
    name: 'share.file',
    title: 'Share File',
    description: 'Share a local file into the active Resonant chat thread.',
    permission: 'write',
    timeoutMs: 5000,
    schema: {
      type: 'object',
      properties: { path: { type: 'string' }, caption: { type: 'string' }, threadId: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
    cliExamples: ['share /absolute/path/to/file'],
  },
  {
    name: 'canvas.create',
    title: 'Create Canvas',
    description: 'Create a Resonant canvas from inline text or a file.',
    permission: 'write',
    timeoutMs: 5000,
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        content: { type: 'string' },
        filePath: { type: 'string' },
        contentType: { type: 'string', enum: ['markdown', 'code', 'text', 'html'] },
        language: { type: 'string' },
        threadId: { type: 'string' },
      },
      required: ['title'],
      additionalProperties: false,
    },
    cliExamples: [
      'canvas create "Title" /path/to/file.md markdown',
      'canvas create-inline "Title" "short text" text',
    ],
  },
  {
    name: 'canvas.update',
    title: 'Update Canvas',
    description: 'Update an existing Resonant canvas.',
    permission: 'write',
    timeoutMs: 5000,
    schema: {
      type: 'object',
      properties: { canvasId: { type: 'string' }, content: { type: 'string' }, filePath: { type: 'string' } },
      required: ['canvasId'],
      additionalProperties: false,
    },
    cliExamples: ['canvas update CANVAS_ID /path/to/file'],
  },
  {
    name: 'voice.send',
    title: 'Send Voice',
    description: 'Generate and send a voice note through Resonant voice services.',
    permission: 'external',
    timeoutMs: 30000,
    schema: { type: 'object', properties: { text: { type: 'string' }, threadId: { type: 'string' } }, required: ['text'], additionalProperties: false },
    cliExamples: ['voice "[whispers] hey [sighs] I missed you"'],
  },
  {
    name: 'reaction.set',
    title: 'React',
    description: 'Add or remove a companion reaction on a chat message.',
    permission: 'write',
    timeoutMs: 2000,
    schema: {
      type: 'object',
      properties: {
        target: { type: 'string' },
        messageId: { type: 'string' },
        emoji: { type: 'string' },
        action: { type: 'string', enum: ['add', 'remove'] },
        threadId: { type: 'string' },
      },
      required: ['emoji'],
      additionalProperties: false,
    },
    cliExamples: ['react last "heart"', 'react last "heart" remove'],
  },
  {
    name: 'semantic.search',
    title: 'Semantic Search',
    description: 'Search Resonant messages by meaning.',
    permission: 'read',
    timeoutMs: 15000,
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        threadId: { type: 'string' },
        role: { type: 'string', enum: ['companion', 'user'] },
        after: { type: 'string' },
        before: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    cliExamples: ['search "semantic query"', 'search "query" --thread THREAD_ID --role companion'],
  },
  {
    name: 'backfill.embeddings',
    title: 'Embedding Backfill',
    description: 'Start, stop, or inspect semantic embedding backfill.',
    permission: 'write',
    timeoutMs: 30000,
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['start', 'status', 'stop'] },
        batchSize: { type: 'number' },
        intervalMs: { type: 'number' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    cliExamples: ['backfill start 50 5000', 'backfill status', 'backfill stop'],
  },
  {
    name: 'routine.manage',
    title: 'Routine',
    description: 'Manage scheduled autonomous routines.',
    permission: 'write',
    timeoutMs: 5000,
    schema: { type: 'object', properties: {}, additionalProperties: true },
    cliExamples: ['routine status', 'routine create "label" "cronExpr" --prompt "what to do when it fires"'],
  },
  {
    name: 'pulse.manage',
    title: 'Pulse',
    description: 'Manage lightweight awareness pulse settings.',
    permission: 'write',
    timeoutMs: 5000,
    schema: { type: 'object', properties: {}, additionalProperties: true },
    cliExamples: ['pulse status', 'pulse enable', 'pulse frequency 15'],
  },
  {
    name: 'failsafe.manage',
    title: 'Failsafe',
    description: 'Manage inactivity escalation check-ins.',
    permission: 'write',
    timeoutMs: 5000,
    schema: { type: 'object', properties: {}, additionalProperties: true },
    cliExamples: ['failsafe status', 'failsafe gentle 120'],
  },
  {
    name: 'trigger.manage',
    title: 'Trigger',
    description: 'Manage impulses and recurring watchers.',
    permission: 'write',
    timeoutMs: 5000,
    schema: { type: 'object', properties: {}, additionalProperties: true },
    cliExamples: [
      'impulse create "label" --condition presence_state:active --prompt "text"',
      'watch create "label" --condition presence_transition:offline:active --prompt "text" --cooldown 480',
    ],
  },
  {
    name: 'telegram.send',
    title: 'Telegram',
    description: 'Send text, media, voice, GIFs, or reactions over Telegram.',
    permission: 'external',
    timeoutMs: 30000,
    schema: { type: 'object', properties: {}, additionalProperties: true },
    cliExamples: ['tg text "proactive message"', 'tg photo /path/to/image.png "caption"', 'tg react last "heart"'],
  },
];

export const COMMAND_CENTER_TOOL_NAMES = [
  'cc_status',
  'cc_task',
  'cc_project',
  'cc_care',
  'cc_event',
  'cc_cycle',
  'cc_pet',
  'cc_list',
  'cc_expense',
  'cc_countdown',
  'cc_daily_win',
  'cc_scratchpad',
  'cc_presence',
] as const;

export const COMMAND_CENTER_TOOLS: InternalToolDefinition[] = COMMAND_CENTER_TOOL_NAMES.map(name => ({
  name,
  title: name.replace(/^cc_/, 'CC ').replace(/_/g, ' '),
  description: `Command Center MCP tool: ${name}.`,
  permission: 'write',
  timeoutMs: 5000,
  schema: { type: 'object', properties: {}, additionalProperties: true },
  cliExamples: [],
}));

export const ALL_INTERNAL_TOOLS = [...INTERNAL_TOOLS, ...FILE_INTERNAL_TOOLS, ...WEB_INTERNAL_TOOLS, ...COMMAND_CENTER_TOOLS];

export function getInternalTool(name: string): InternalToolDefinition | undefined {
  return ALL_INTERNAL_TOOLS.find(tool => tool.name === name);
}

export async function executeInternalTool(
  name: string,
  args: Record<string, unknown>,
  context: InternalToolContext,
): Promise<InternalToolResult> {
  const tool = getInternalTool(name);
  if (!tool) return { ok: false, text: `Unknown Resonant tool: ${name}`, error: 'unknown_tool' };
  if (!tool.handler) {
    return {
      ok: false,
      text: `${tool.name} is registered but not yet available through the provider-neutral executor. Use the compatibility sc.mjs surface for now.`,
      error: 'unsupported_registry_handler',
    };
  }
  try {
    return await tool.handler(args, context);
  } catch (err) {
    return {
      ok: false,
      text: err instanceof Error ? err.message : String(err),
      error: 'tool_error',
    };
  }
}

export function buildCliToolInstructions(scCommand: string, platform: string): string {
  const lines = [
    'CHAT TOOLS (compatibility CLI; threadId auto-injected):',
    `  ${scCommand} share /absolute/path/to/file`,
    `  ${scCommand} canvas create "Title" /path/to/file.md markdown`,
    `  ${scCommand} canvas create-inline "Title" "short text" text`,
    `  ${scCommand} canvas update CANVAS_ID /path/to/file`,
    '  contentType: markdown|code|text|html. Files in shared/ auto-share.',
    `  ${scCommand} react last "heart"             (react to last message)`,
    `  ${scCommand} react last-2 "fire"            (react to 2nd-to-last message)`,
    `  ${scCommand} react last "heart" remove      (remove a reaction)`,
    `  ${scCommand} voice "[whispers] hey [sighs] I missed you"`,
    `  ${scCommand} search "semantic query"`,
    `  ${scCommand} search "query" --thread THREAD_ID`,
    `  ${scCommand} search "query" --role companion|user`,
    `  ${scCommand} search "query" --after 2026-03-01`,
    `  ${scCommand} search "query" --before 2026-03-15`,
    `  ${scCommand} backfill start [batch] [intervalMs]`,
    `  ${scCommand} backfill status`,
    `  ${scCommand} backfill stop`,
    '',
    'ROUTINES (scheduled autonomous sessions):',
    `  ${scCommand} routine status|enable|disable|reschedule [wakeType] [cronExpr]`,
    `  ${scCommand} routine create "label" "cronExpr" --prompt "what to do when it fires"`,
    `  ${scCommand} routine remove ROUTINE_ID`,
    '',
    'PULSE:',
    `  ${scCommand} pulse status|enable|disable`,
    `  ${scCommand} pulse frequency MINUTES`,
    '',
    'FAILSAFE:',
    `  ${scCommand} failsafe status`,
    `  ${scCommand} failsafe enable|disable`,
    `  ${scCommand} failsafe gentle|concerned|emergency MINUTES`,
    '',
    'TIMERS:',
    `  ${scCommand} timer create "label" "context" "fireAt"`,
    `  ${scCommand} timer list`,
    `  ${scCommand} timer cancel TIMER_ID`,
    '',
    'IMPULSE QUEUE:',
    `  ${scCommand} impulse create "label" --condition presence_state:active --prompt "text"`,
    `  ${scCommand} impulse list`,
    `  ${scCommand} impulse cancel TRIGGER_ID`,
    '',
    'WATCHERS:',
    `  ${scCommand} watch create "label" --condition presence_transition:offline:active --prompt "text" --cooldown 480`,
    `  ${scCommand} watch list`,
    `  ${scCommand} watch cancel TRIGGER_ID`,
    '  Conditions: presence_state:<state>, presence_transition:<from>:<to>, agent_free, time_window:<HH:MM>, routine_missing:<name>:<hour>',
  ];

  if (platform === 'telegram') {
    lines.push(
      '',
      'TELEGRAM TOOLS:',
      `  ${scCommand} tg photo /path/to/image.png "caption"`,
      `  ${scCommand} tg photo --url "https://..." "caption"`,
      `  ${scCommand} tg doc /path/to/file.pdf "caption"`,
      `  ${scCommand} tg gif "search query" "optional caption"`,
      `  ${scCommand} tg react last "heart"`,
      `  ${scCommand} tg voice "text with [tone tags]"`,
      `  ${scCommand} tg text "proactive message"`,
    );
  }

  return lines.join('\n');
}

export function buildProviderToolCallInstructions(): string {
  const executable = ALL_INTERNAL_TOOLS.filter(tool => tool.handler);
  const lines = [
    'RESONANT INTERNAL TOOLS (provider-neutral executor):',
    'When a registered tool is needed and native tool calling is unavailable, output exactly one fenced block:',
    '```resonant-tool-call',
    '{"name":"timer.list","arguments":{}}',
    '```',
    'Then stop. Resonant will execute it and continue the turn with the tool result.',
    '',
    'Currently executable tools:',
    'If the user provides a local filesystem path, prefer file.stat, file.list, file.read, file.search, file.write, or file.edit. Do not answer from memory when a path should be inspected directly.',
    'If the user provides a web URL and current page contents are needed, prefer web.fetch. Do not answer from memory when a URL should be inspected directly.',
    ...executable.map(tool => `- ${tool.name}: ${tool.description}`),
  ];
  return lines.join('\n');
}
