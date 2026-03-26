// Command system — registry, dispatch, and handlers for slash commands

import { readFileSync, existsSync, readdirSync } from 'fs';
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
// Built-in command definitions
// ---------------------------------------------------------------------------

const BUILTIN_COMMANDS: CommandRegistryEntry[] = [
  { name: 'compact', description: 'Force context compaction on current session', category: 'builtin' },
  { name: 'clear', description: 'Start a fresh session on the current thread', category: 'builtin' },
  { name: 'new', description: 'Create a new named thread', category: 'builtin', args: '[name]' },
  { name: 'rename', description: 'Rename the current thread', category: 'builtin', args: '[name]' },
  { name: 'model', description: 'Switch the active model', category: 'builtin', args: '[model]' },
  { name: 'status', description: 'Show system status — MCP, session, connection', category: 'builtin' },
  { name: 'cost', description: 'Show token usage for the current session', category: 'builtin' },
  { name: 'stop', description: 'Stop the current generation', category: 'builtin', clientOnly: true },
  { name: 'retry', description: 'Retry the last user message', category: 'builtin' },
  { name: 'help', description: 'Show all available commands', category: 'builtin', clientOnly: true },
  { name: 'mcp', description: 'Show MCP server status', category: 'builtin' },
  { name: 'triggers', description: 'List active triggers and watchers', category: 'builtin' },
  { name: 'wake', description: 'Trigger a manual wake cycle', category: 'builtin', args: '[type]' },
];

// ---------------------------------------------------------------------------
// Custom command scanning
// ---------------------------------------------------------------------------

interface CustomCommandInfo {
  name: string;
  description: string;
  path: string;
}

let customCommandCache: { commands: CustomCommandInfo[]; scannedAt: number } | null = null;
const CACHE_MS = 60 * 1000;

function scanCustomCommands(): CustomCommandInfo[] {
  const config = getResonantConfig();
  const commandsDir = join(config.agent.cwd, '.claude', 'commands');

  if (customCommandCache && (Date.now() - customCommandCache.scannedAt) < CACHE_MS) {
    return customCommandCache.commands;
  }

  try {
    if (!existsSync(commandsDir)) return [];

    const entries = readdirSync(commandsDir).filter(f => f.endsWith('.md'));
    const commands: CustomCommandInfo[] = [];

    for (const filename of entries) {
      const filePath = join(commandsDir, filename);
      const content = readFileSync(filePath, 'utf-8');
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!frontmatterMatch) continue;

      const fm = frontmatterMatch[1];
      const nameMatch = fm.match(/^name:\s*(.+)$/m);
      const descMatch = fm.match(/^description:\s*(.+)$/m);

      commands.push({
        name: nameMatch ? nameMatch[1].trim() : filename.replace('.md', ''),
        description: descMatch ? descMatch[1].trim() : '',
        path: filePath.replace(/\\/g, '/'),
      });
    }

    customCommandCache = { commands, scannedAt: Date.now() };
    return commands;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Registry builder
// ---------------------------------------------------------------------------

export function buildCommandRegistry(): CommandRegistryEntry[] {
  const registry: CommandRegistryEntry[] = [...BUILTIN_COMMANDS];

  // Add skills
  const skills = scanSkills();
  for (const skill of skills) {
    registry.push({
      name: skill.dirName,
      description: skill.description.length > 120
        ? skill.description.substring(0, 120) + '...'
        : skill.description,
      category: 'skill',
      args: '[query]',
    });
  }

  // Add custom commands
  const customs = scanCustomCommands();
  for (const cmd of customs) {
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

export async function handleCommand(
  name: string,
  args: string | undefined,
  threadId: string | undefined,
  services: CommandServices,
): Promise<ServerMessage> {
  try {
    switch (name) {
      case 'compact': return await handleCompact(threadId, services);
      case 'clear': return await handleClear(threadId, services);
      case 'new': return handleNew(args);
      case 'rename': return handleRename(threadId, args);
      case 'model': return handleModel(args);
      case 'status': return await handleStatus(services);
      case 'cost': return handleCost();
      case 'retry': return await handleRetry(threadId, services);
      case 'mcp': return handleMcp(services);
      case 'triggers': return handleTriggers();
      case 'wake': return await handleWake(args, services);
      default:
        // Check if it's a skill command
        return await handleSkillOrCustom(name, args, threadId, services);
    }
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
// Built-in handlers
// ---------------------------------------------------------------------------

async function handleCompact(threadId: string | undefined, services: CommandServices): Promise<ServerMessage> {
  if (!threadId) {
    return { type: 'command_result', name: 'compact', success: false, error: 'No active thread', display: 'toast' };
  }

  // Send a compaction-triggering message through the agent
  await services.agent.processMessage(
    threadId,
    '/compact — User requested context compaction. Please compact the conversation context now.',
    undefined,
    { platform: 'web' },
  );

  return { type: 'command_result', name: 'compact', success: true, display: 'silent' };
}

async function handleClear(threadId: string | undefined, services: CommandServices): Promise<ServerMessage> {
  if (!threadId) {
    return { type: 'command_result', name: 'clear', success: false, error: 'No active thread', display: 'toast' };
  }

  // Clear session ID so next message starts fresh
  const db = getDb();
  db.prepare('UPDATE threads SET current_session_id = NULL, needs_reground = 1 WHERE id = ?').run(threadId);

  return {
    type: 'command_result',
    name: 'clear',
    success: true,
    data: { message: 'Session cleared. Next message starts a fresh session.' },
    display: 'toast',
  };
}

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
    data: { threadId: thread.id, threadName: thread.name },
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

  const db = getDb();
  db.prepare('UPDATE threads SET name = ? WHERE id = ?').run(newName, threadId);

  return {
    type: 'command_result',
    name: 'rename',
    success: true,
    data: { threadId, oldName: thread.name, newName },
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
      data: { currentModel: current },
      display: 'toast',
    };
  }

  setConfig('agent.model', modelId);

  return {
    type: 'command_result',
    name: 'model',
    success: true,
    data: { model: modelId, message: `Model switched to ${modelId}` },
    display: 'toast',
  };
}

async function handleStatus(services: CommandServices): Promise<ServerMessage> {
  const mem = process.memoryUsage();
  const orchestratorTasks = services.orchestrator ? await services.orchestrator.getStatus() : [];
  const mcpServers = services.agent.getMcpStatus();

  return {
    type: 'command_result',
    name: 'status',
    success: true,
    data: {
      uptime: process.uptime(),
      memoryMb: Math.round(mem.heapUsed / 1024 / 1024),
      connections: services.registry.getCount(),
      presence: services.agent.getPresenceStatus(),
      processing: services.agent.isProcessing(),
      queueDepth: services.agent.getQueueDepth(),
      mcpServers: mcpServers.map(s => ({ name: s.name, status: s.status, tools: s.toolCount })),
      orchestratorTasks: orchestratorTasks.length,
    },
    display: 'panel',
  };
}

function handleCost(): ServerMessage {
  // Pull session cost tracking from config (agent.ts stores these)
  const tokensUsed = getConfig('session.tokens_used');
  const costUsd = getConfig('session.cost_usd');

  return {
    type: 'command_result',
    name: 'cost',
    success: true,
    data: {
      tokensUsed: tokensUsed ? parseInt(tokensUsed, 10) : 0,
      costUsd: costUsd ? parseFloat(costUsd) : 0,
      message: tokensUsed
        ? `Tokens: ${parseInt(tokensUsed, 10).toLocaleString()} | Cost: $${parseFloat(costUsd || '0').toFixed(4)}`
        : 'No token usage tracked for this session',
    },
    display: 'toast',
  };
}

async function handleRetry(threadId: string | undefined, services: CommandServices): Promise<ServerMessage> {
  if (!threadId) {
    return { type: 'command_result', name: 'retry', success: false, error: 'No active thread', display: 'toast' };
  }

  // Get recent messages and find the last user message
  const messages = getMessages({ threadId, limit: 20 });
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');

  if (!lastUserMsg) {
    return { type: 'command_result', name: 'retry', success: false, error: 'No user message found to retry', display: 'toast' };
  }

  const thread = getThread(threadId);
  // Re-send through agent
  await services.agent.processMessage(
    threadId,
    lastUserMsg.content,
    thread ? { name: thread.name, type: thread.type } : undefined,
    { platform: 'web' },
  );

  return { type: 'command_result', name: 'retry', success: true, display: 'silent' };
}

function handleMcp(services: CommandServices): ServerMessage {
  const servers = services.agent.getMcpStatus();

  return {
    type: 'command_result',
    name: 'mcp',
    success: true,
    data: {
      servers: servers.map(s => ({
        name: s.name,
        status: s.status,
        error: s.error,
        toolCount: s.toolCount,
        tools: s.tools?.map(t => t.name),
      })),
    },
    display: 'panel',
  };
}

function handleTriggers(): ServerMessage {
  const active = getActiveTriggers();
  const all = listTriggers();

  return {
    type: 'command_result',
    name: 'triggers',
    success: true,
    data: {
      active: active.length,
      total: all.length,
      triggers: all.map(t => ({
        id: t.id,
        kind: t.kind,
        label: t.label,
        status: t.status,
        createdAt: t.created_at,
      })),
    },
    display: 'panel',
  };
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
    data: { wakeType, message: `Wake cycle triggered (${wakeType})` },
    display: 'toast',
  };
}

// ---------------------------------------------------------------------------
// Skill & custom command handler
// ---------------------------------------------------------------------------

async function handleSkillOrCustom(
  name: string,
  args: string | undefined,
  threadId: string | undefined,
  services: CommandServices,
): Promise<ServerMessage> {
  if (!threadId) {
    return { type: 'command_result', name, success: false, error: 'No active thread', display: 'toast' };
  }

  // Try skill first
  const skills = scanSkills();
  const skill = skills.find(s => s.dirName === name || s.name === name);

  if (skill) {
    const content = readFileSync(skill.path, 'utf-8');
    const userText = args?.trim() || 'Invoke this skill';
    const enrichedPrompt = `[SKILL: ${skill.name}]\n${content}\n[/SKILL]\n\nUser request: ${userText}`;

    const thread = getThread(threadId);
    await services.agent.processMessage(
      threadId,
      enrichedPrompt,
      thread ? { name: thread.name, type: thread.type } : undefined,
      { platform: 'web' },
    );

    return { type: 'command_result', name, success: true, display: 'silent' };
  }

  // Try custom command
  const customs = scanCustomCommands();
  const custom = customs.find(c => c.name === name);

  if (custom) {
    const content = readFileSync(custom.path, 'utf-8');
    const userText = args?.trim() || 'Execute this command';
    const enrichedPrompt = `[COMMAND: ${custom.name}]\n${content}\n[/COMMAND]\n\nUser request: ${userText}`;

    const thread = getThread(threadId);
    await services.agent.processMessage(
      threadId,
      enrichedPrompt,
      thread ? { name: thread.name, type: thread.type } : undefined,
      { platform: 'web' },
    );

    return { type: 'command_result', name, success: true, display: 'silent' };
  }

  return {
    type: 'command_result',
    name,
    success: false,
    error: `Unknown command: /${name}`,
    display: 'toast',
  };
}
