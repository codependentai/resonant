// Command system — registry for the dropdown, handlers for UI-only commands.
// Skills, custom commands, /compact, /clear all pass through to the Agent SDK as prompt text.

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import crypto from 'crypto';
import type { CommandRegistryEntry, ServerMessage } from '@resonant/shared';
import { scanSkills } from './hooks.js';
import {
  getDb,
  getThread,
  createThread,
  getMessages,
  listThreads,
  getConfig,
  setConfig,
  getActiveTriggers,
  listTriggers,
} from './db.js';
import { AgentService } from './agent.js';
import { Orchestrator } from './orchestrator.js';
import { getResonantConfig } from '../config.js';
import type { ConnectionRegistry } from '../types.js';

// ---------------------------------------------------------------------------
// UI-only commands (we handle, never touch the agent)
// ---------------------------------------------------------------------------

const UI_COMMANDS: CommandRegistryEntry[] = [
  { name: 'new', description: 'Create a new named thread', category: 'builtin', args: '[name]' },
  { name: 'rename', description: 'Rename the current thread', category: 'builtin', args: '[name]' },
  { name: 'model', description: 'Switch the active model', category: 'builtin', args: '[model]' },
  { name: 'status', description: 'System status — uptime, MCP, queue', category: 'builtin' },
  { name: 'cost', description: 'Token usage for the current session', category: 'builtin' },
  { name: 'mcp', description: 'MCP server connection status', category: 'builtin' },
  { name: 'triggers', description: 'List active triggers and watchers', category: 'builtin' },
  { name: 'retry', description: 'Retry the last message', category: 'builtin' },
  { name: 'wake', description: 'Trigger a manual wake cycle', category: 'builtin', args: '[type]' },
  { name: 'stop', description: 'Stop the current generation', category: 'builtin', clientOnly: true },
  { name: 'help', description: 'Show all available commands', category: 'builtin', clientOnly: true },
];

// SDK-handled commands (listed in dropdown, passed straight through as prompt)
const SDK_COMMANDS: CommandRegistryEntry[] = [
  { name: 'compact', description: 'Compact the conversation context', category: 'builtin' },
  { name: 'clear', description: 'Clear conversation and start fresh', category: 'builtin' },
];

// ---------------------------------------------------------------------------
// Custom command scanning (for dropdown discovery only)
// ---------------------------------------------------------------------------

let customCommandCache: { commands: { name: string; description: string }[]; scannedAt: number } | null = null;
const CACHE_MS = 60 * 1000;

function scanCustomCommands(): { name: string; description: string }[] {
  const config = getResonantConfig();
  const commandsDir = join(config.agent.cwd, '.claude', 'commands');

  if (customCommandCache && (Date.now() - customCommandCache.scannedAt) < CACHE_MS) {
    return customCommandCache.commands;
  }

  try {
    if (!existsSync(commandsDir)) return [];

    const entries = readdirSync(commandsDir).filter(f => f.endsWith('.md'));
    const commands: { name: string; description: string }[] = [];

    for (const filename of entries) {
      const content = readFileSync(join(commandsDir, filename), 'utf-8');
      const fm = content.match(/^---\n([\s\S]*?)\n---/)?.[1] || '';
      const name = fm.match(/^name:\s*(.+)$/m)?.[1]?.trim() || filename.replace('.md', '');
      const desc = fm.match(/^description:\s*(.+)$/m)?.[1]?.trim() || '';
      commands.push({ name, description: desc });
    }

    customCommandCache = { commands, scannedAt: Date.now() };
    return commands;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Registry builder (populates the dropdown)
// ---------------------------------------------------------------------------

export function buildCommandRegistry(): CommandRegistryEntry[] {
  const registry: CommandRegistryEntry[] = [...UI_COMMANDS, ...SDK_COMMANDS];

  for (const skill of scanSkills()) {
    registry.push({
      name: skill.dirName,
      description: skill.description.length > 120
        ? skill.description.substring(0, 120) + '...'
        : skill.description,
      category: 'skill',
    });
  }

  for (const cmd of scanCustomCommands()) {
    registry.push({
      name: cmd.name,
      description: cmd.description.length > 120
        ? cmd.description.substring(0, 120) + '...'
        : cmd.description,
      category: 'custom',
    });
  }

  return registry;
}

// ---------------------------------------------------------------------------
// Command dispatch
// ---------------------------------------------------------------------------

export interface CommandServices {
  agent: AgentService;
  orchestrator?: Orchestrator;
  registry: ConnectionRegistry;
}

const UI_COMMAND_NAMES = new Set(UI_COMMANDS.filter(c => !c.clientOnly).map(c => c.name));

export async function handleCommand(
  name: string,
  args: string | undefined,
  threadId: string | undefined,
  services: CommandServices,
): Promise<ServerMessage> {
  try {
    if (UI_COMMAND_NAMES.has(name)) {
      switch (name) {
        case 'new': return handleNew(args);
        case 'rename': return handleRename(threadId, args);
        case 'model': return handleModel(args);
        case 'status': return await handleStatus(services);
        case 'cost': return handleCost(services);
        case 'mcp': return handleMcp(services);
        case 'triggers': return handleTriggers();
        case 'retry': return await handleRetry(threadId, services);
        case 'wake': return await handleWake(args, services);
      }
    }

    // Everything else — pass through to the Agent SDK as prompt text
    if (!threadId) {
      return { type: 'command_result', name, success: false, error: 'No active thread', display: 'toast' };
    }

    const prompt = args ? `/${name} ${args}` : `/${name}`;
    const thread = getThread(threadId);
    await services.agent.processMessage(
      threadId,
      prompt,
      thread ? { name: thread.name, type: thread.type } : undefined,
      { platform: 'web' },
    );

    return { type: 'command_result', name, success: true, display: 'silent' };
  } catch (err) {
    return {
      type: 'command_result',
      name,
      success: false,
      error: err instanceof Error ? err.message : String(err),
      display: 'toast',
    };
  }
}

// ---------------------------------------------------------------------------
// UI command handlers
// ---------------------------------------------------------------------------

function handleNew(args: string | undefined): ServerMessage {
  const name = args?.trim();
  if (!name) {
    return { type: 'command_result', name: 'new', success: false, error: 'Usage: /new [thread name]', display: 'toast' };
  }

  const thread = createThread({
    id: crypto.randomUUID(),
    name,
    type: 'named',
    createdAt: new Date().toISOString(),
  });

  return {
    type: 'command_result',
    name: 'new',
    success: true,
    data: { threadId: thread.id, message: `Thread "${thread.name}" created` },
    display: 'toast',
  };
}

function handleRename(threadId: string | undefined, args: string | undefined): ServerMessage {
  const newName = args?.trim();
  if (!newName) {
    return { type: 'command_result', name: 'rename', success: false, error: 'Usage: /rename [new name]', display: 'toast' };
  }
  if (!threadId) {
    return { type: 'command_result', name: 'rename', success: false, error: 'No active thread', display: 'toast' };
  }

  const thread = getThread(threadId);
  if (!thread) {
    return { type: 'command_result', name: 'rename', success: false, error: 'Thread not found', display: 'toast' };
  }

  getDb().prepare('UPDATE threads SET name = ? WHERE id = ?').run(newName, threadId);

  return {
    type: 'command_result',
    name: 'rename',
    success: true,
    data: { message: `Renamed "${thread.name}" to "${newName}"` },
    display: 'toast',
  };
}

function handleModel(args: string | undefined): ServerMessage {
  const modelId = args?.trim();
  if (!modelId) {
    const current = getConfig('agent.model') || getResonantConfig().agent.model;
    return {
      type: 'command_result',
      name: 'model',
      success: true,
      data: { message: `Current model: ${current}` },
      display: 'toast',
    };
  }

  setConfig('agent.model', modelId);

  return {
    type: 'command_result',
    name: 'model',
    success: true,
    data: { message: `Model switched to ${modelId}` },
    display: 'toast',
  };
}

async function handleStatus(services: CommandServices): Promise<ServerMessage> {
  const mem = process.memoryUsage();
  const orchestratorTasks = services.orchestrator ? await services.orchestrator.getStatus() : [];
  const mcpServers = services.agent.getMcpStatus();
  const uptimeH = Math.floor(process.uptime() / 3600);
  const uptimeM = Math.floor((process.uptime() % 3600) / 60);
  const connected = mcpServers.filter(s => s.status === 'connected').length;
  const usage = services.agent.getContextUsage();

  const message = [
    `Uptime: ${uptimeH}h ${uptimeM}m`,
    `Mem: ${Math.round(mem.heapUsed / 1024 / 1024)}MB`,
    `Presence: ${services.agent.getPresenceStatus()}`,
    `MCP: ${connected}/${mcpServers.length}`,
    `Tokens: ${usage.tokensUsed > 0 ? `${usage.tokensUsed.toLocaleString()}/${usage.contextWindow.toLocaleString()}` : 'no session'}`,
    `Queue: ${services.agent.getQueueDepth()}`,
    `Tasks: ${orchestratorTasks.length}`,
  ].join(' | ');

  return {
    type: 'command_result',
    name: 'status',
    success: true,
    data: { message },
    display: 'toast',
  };
}

function handleCost(services: CommandServices): ServerMessage {
  const usage = services.agent.getContextUsage();

  const message = usage.tokensUsed > 0
    ? `Tokens: ${usage.tokensUsed.toLocaleString()} / ${usage.contextWindow.toLocaleString()} (${Math.round((usage.tokensUsed / usage.contextWindow) * 100)}%)`
    : 'No active session — send a message first to start tracking';

  return {
    type: 'command_result',
    name: 'cost',
    success: true,
    data: { message },
    display: 'toast',
  };
}

function handleMcp(services: CommandServices): ServerMessage {
  const servers = services.agent.getMcpStatus();
  const lines = servers.map(s => {
    const icon = s.status === 'connected' ? 'ok' : s.status;
    return `${s.name}: ${icon} (${s.toolCount} tools)`;
  });

  return {
    type: 'command_result',
    name: 'mcp',
    success: true,
    data: { message: lines.join(' | ') || 'No MCP servers configured' },
    display: 'toast',
  };
}

function handleTriggers(): ServerMessage {
  const active = getActiveTriggers();
  const all = listTriggers();
  const message = all.length === 0
    ? 'No triggers set'
    : `${active.length} active / ${all.length} total — ${all.map(t => `${t.label} (${t.kind}, ${t.status})`).join(', ')}`;

  return {
    type: 'command_result',
    name: 'triggers',
    success: true,
    data: { message },
    display: 'toast',
  };
}

async function handleRetry(threadId: string | undefined, services: CommandServices): Promise<ServerMessage> {
  if (!threadId) {
    return { type: 'command_result', name: 'retry', success: false, error: 'No active thread', display: 'toast' };
  }

  const msgs = getMessages({ threadId, limit: 20 });
  const lastUserMsg = [...msgs].reverse().find(m => m.role === 'user');
  if (!lastUserMsg) {
    return { type: 'command_result', name: 'retry', success: false, error: 'No message found to retry', display: 'toast' };
  }

  const thread = getThread(threadId);
  await services.agent.processMessage(
    threadId,
    lastUserMsg.content,
    thread ? { name: thread.name, type: thread.type } : undefined,
    { platform: 'web' },
  );

  return { type: 'command_result', name: 'retry', success: true, display: 'silent' };
}

async function handleWake(args: string | undefined, services: CommandServices): Promise<ServerMessage> {
  if (!services.orchestrator) {
    return { type: 'command_result', name: 'wake', success: false, error: 'Orchestrator not running', display: 'toast' };
  }

  const wakeType = args?.trim() || 'manual';
  await services.orchestrator.triggerManualWake(wakeType);

  return {
    type: 'command_result',
    name: 'wake',
    success: true,
    data: { message: `Wake cycle triggered (${wakeType})` },
    display: 'toast',
  };
}
