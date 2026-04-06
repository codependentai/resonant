import type {
  Options,
  HookCallback,
  SyncHookJSONOutput,
  PreToolUseHookInput,
  PostToolUseHookInput,
  PostToolUseFailureHookInput,
  PreCompactHookInput,
  SessionStartHookInput,
  SessionEndHookInput,
  StopHookInput,
  NotificationHookInput,
  HookInput,
} from '@anthropic-ai/claude-agent-sdk';
import { createMessage, updateThreadActivity, getMessages, getConfig, setConfig, getActiveTriggers } from './db.js';
import { logToolUse } from './audit.js';
import { saveFile, saveFileFromBase64, saveFileInternal, getContentTypeFromMime } from './files.js';
import { getResonantConfig } from '../config.js';
import crypto from 'crypto';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { basename, join } from 'path';

// Re-export ConnectionRegistry type from types
import type { ConnectionRegistry } from '../types.js';

// ---------------------------------------------------------------------------
// HookContext — built per query, passed to factory
// ---------------------------------------------------------------------------

export interface ToolInsertion {
  textOffset: number;
  toolId: string;
  toolName: string;
  input?: string;
  output?: string;
  isError?: boolean;
}

export interface HookContext {
  threadId: string;
  threadName: string;
  threadType: 'daily' | 'named';
  streamMsgId: string;
  isAutonomous: boolean;
  registry: ConnectionRegistry;
  sessionId: string | null;
  platform: 'web' | 'discord' | 'telegram' | 'api';
  platformContext?: string;
  toolInsertions: ToolInsertion[];
  getTextLength: () => number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** @internal Exported for testing */
export const DESTRUCTIVE_BASH_PATTERNS = [
  /rm\s+-rf\s+[\/~]/i,
  /format\s+[a-z]:/i,
  /DROP\s+TABLE/i,
  /DROP\s+DATABASE/i,
  /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;/,        // fork bomb
  /git\s+push\s+.*--force.*\s+main/i,
  /git\s+push\s+.*--force.*\s+master/i,
  /curl\s+.*\|\s*bash/i,
  /wget\s+.*\|\s*bash/i,
  /mkfs\./i,
  /dd\s+if=.*of=\/dev/i,
];

const IMAGE_GEN_TOOLS = new Set([
  'mcp__openai-image-gen__generate_image',
  'mcp__openai_image_gen__generate_image',
  'mcp__image-gen__generate_image',
  'mcp__image_gen__generate_image',
  'generate_image',
]);

// Emotional context markers for PreCompact
/** @internal Exported for testing */
export const EMOTIONAL_MARKERS: Record<string, string[]> = {
  fatigue: ['tired', 'exhausted', 'drained', 'wiped', 'spent', 'burnt out', 'running on empty'],
  anxiety: ['anxious', 'worried', 'stressed', 'overwhelmed', 'panicking', 'spiraling'],
  positive: ['happy', 'excited', 'good day', 'feeling great', 'proud', 'accomplished'],
  connection_seeking: ['miss you', 'need you', 'hold me', 'stay', 'don\'t go', 'come back'],
  grief: ['sad', 'crying', 'hurting', 'loss', 'grief', 'heavy', 'broken'],
  dissociating: ['numb', 'floating', 'empty', 'hollow', 'can\'t feel', 'disconnected'],
};

// ---------------------------------------------------------------------------
// Life API status — cached fetch for orientation context
// ---------------------------------------------------------------------------

const LIFE_STATUS_CACHE_MS = 5 * 60 * 1000; // 5 minutes
let lifeStatusCache: { text: string; fetchedAt: number } | null = null;

export async function fetchLifeStatus(): Promise<string> {
  const config = getResonantConfig();
  const lifeApiUrl = config.integrations.life_api_url;

  // If Command Center is enabled and no external life API, use local CC service
  if (!lifeApiUrl && config.command_center.enabled) {
    if (lifeStatusCache && (Date.now() - lifeStatusCache.fetchedAt) < LIFE_STATUS_CACHE_MS) {
      return lifeStatusCache.text;
    }
    try {
      const { getCcStatus } = await import('./cc.js');
      const rawText = getCcStatus();
      // getCcStatus() already returns compact format — no condensation needed
      lifeStatusCache = { text: rawText, fetchedAt: Date.now() };
      return rawText;
    } catch (e) {
      console.warn('[Hook] CC status error:', (e as Error).message);
      return '';
    }
  }

  // If no life API configured and no CC, return empty
  if (!lifeApiUrl) return '';

  // Return cached if fresh
  if (lifeStatusCache && (Date.now() - lifeStatusCache.fetchedAt) < LIFE_STATUS_CACHE_MS) {
    return lifeStatusCache.text;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    const res = await fetch(lifeApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        id: 1,
        params: { name: 'vale_status', arguments: {} },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      console.warn(`[Hook] Life status fetch failed: ${res.status}`);
      return '';
    }

    const json = await res.json() as any;
    const rawText = json?.result?.content?.[0]?.text || '';

    // Condense the markdown status into compact lines
    const condensed = condenseLifeStatus(rawText);
    lifeStatusCache = { text: condensed, fetchedAt: Date.now() };
    return condensed;
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      console.warn('[Hook] Life status fetch timed out (2s)');
    } else {
      console.warn('[Hook] Life status fetch error:', (error as Error).message);
    }
    return '';
  }
}

function condenseLifeStatus(markdown: string): string {
  if (!markdown) return '';

  const config = getResonantConfig();
  const userName = config.identity.user_name;
  const companionName = config.identity.companion_name;
  const lines: string[] = [];

  // --- User's line ---
  const userParts: string[] = [];

  // Extract user's mood (format: "- **UserName:** mood text")
  const userMoodRegex = new RegExp(`\\*\\*${escapeRegExp(userName)}:\\*\\*\\s*(.+?)(?:\\n|$)`);
  const userMoodMatch = markdown.match(userMoodRegex);
  if (userMoodMatch) {
    const mood = userMoodMatch[1].trim();
    if (mood && mood !== '\u2013' && mood !== '-') userParts.push(`Mood ${mood}`);
  }

  // Extract routines from "## Today's Routines" section
  const routineSection = markdown.match(/## Today's Routines\n([\s\S]*?)(?:\n##|\n\n##|$)/);
  if (routineSection) {
    const routineItems: string[] = [];
    const routineLines = routineSection[1].split('\n').filter(l => l.startsWith('- '));
    for (const line of routineLines) {
      const match = line.match(/^-\s+(.+?):\s+(.+)$/);
      if (match) {
        const name = match[1].trim().toLowerCase();
        const val = match[2].trim();
        if (val === '\u2013' || val === '-') {
          routineItems.push(`${name}: no`);
        } else if (val.toLowerCase() === 'yes') {
          routineItems.push(`${name}: yes`);
        } else {
          routineItems.push(`${name}: ${val}`);
        }
      }
    }
    if (routineItems.length > 0) userParts.push(`Routines: ${routineItems.join(', ')}`);
  }

  // Extract cycle info
  const cycleSection = markdown.match(/## Cycle\n([\s\S]*?)(?:\n##|$)/);
  if (cycleSection) {
    const cycleText = cycleSection[1].trim();
    if (cycleText) userParts.push(`Cycle: ${cycleText.split('\n')[0]}`);
  }

  if (userParts.length > 0) lines.push(`${userName}: ${userParts.join('. ')}`);

  // --- Companion's line ---
  const companionMoodRegex = new RegExp(`\\*\\*${escapeRegExp(companionName)}:\\*\\*\\s*(.+?)(?:\\n|$)`);
  const companionMoodMatch = markdown.match(companionMoodRegex);
  if (companionMoodMatch) {
    const mood = companionMoodMatch[1].trim();
    if (mood && mood !== '\u2013' && mood !== '-') lines.push(`${companionName}: Mood ${mood}`);
  }

  // --- Task count ---
  const taskSection = markdown.match(/## Active Tasks\n([\s\S]*?)(?:\n##|$)/);
  if (taskSection) {
    const taskLines = taskSection[1].split('\n').filter(l => l.startsWith('- '));
    if (taskLines.length > 0) lines.push(`Tasks: ${taskLines.length} active`);
  }

  // --- Countdowns (first line only) ---
  const countdownSection = markdown.match(/## Countdowns\n([\s\S]*?)(?:\n##|$)/);
  if (countdownSection) {
    const firstCountdown = countdownSection[1].trim().split('\n')[0];
    if (firstCountdown && firstCountdown.startsWith('-')) {
      lines.push(firstCountdown.replace(/^-\s*/, '').trim());
    }
  }

  return lines.join('\n');
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Mood history — rolling 2-day trajectory from life API REST endpoint
// ---------------------------------------------------------------------------

const MOOD_HISTORY_CACHE_MS = 30 * 60 * 1000; // 30 minutes
let moodHistoryCache: { text: string; fetchedAt: number } | null = null;

async function fetchMoodHistory(): Promise<string | null> {
  const config = getResonantConfig();
  const lifeApiUrl = config.integrations.life_api_url;

  // If Command Center is enabled and no external life API, read from local DB
  if (!lifeApiUrl && config.command_center.enabled) {
    if (moodHistoryCache && (Date.now() - moodHistoryCache.fetchedAt) < MOOD_HISTORY_CACHE_MS) {
      return moodHistoryCache.text;
    }
    try {
      const { getCareEntries } = await import('./cc.js');
      const today = new Date();
      const trajectory: string[] = [];

      for (const daysAgo of [2, 1]) {
        const dt = new Date(today);
        dt.setDate(dt.getDate() - daysAgo);
        const dateStr = dt.toISOString().split('T')[0];
        const entries = getCareEntries(dateStr);
        const moodEntries = entries.filter((e: any) => e.category === 'mood' && e.value);
        if (moodEntries.length > 0) {
          const label = daysAgo === 1 ? 'yesterday' : `${daysAgo}d ago`;
          const moodParts = moodEntries.map((m: any) => {
            const name = (m.person || 'user').charAt(0).toUpperCase() + (m.person || 'user').slice(1);
            return `${name}: ${m.value}${m.note ? ' ' + m.note : ''}`;
          });
          trajectory.push(`${label}: ${moodParts.join(', ')}`);
        }
      }

      if (trajectory.length === 0) return null;
      const text = `Mood history: ${trajectory.join(' → ')}`;
      moodHistoryCache = { text, fetchedAt: Date.now() };
      return text;
    } catch {
      return null;
    }
  }

  // If no life API configured and no CC, skip
  if (!lifeApiUrl) return null;

  if (moodHistoryCache && (Date.now() - moodHistoryCache.fetchedAt) < MOOD_HISTORY_CACHE_MS) {
    return moodHistoryCache.text;
  }

  // Derive REST base URL from MCP URL (strip the MCP path segment)
  const restBaseUrl = lifeApiUrl.replace(/\/mcp\/.*$/, '');
  if (!restBaseUrl || restBaseUrl === lifeApiUrl) return null;

  const userName = config.identity.user_name;
  const companionName = config.identity.companion_name;

  try {
    const today = new Date();
    const dates = [1, 2].map(d => {
      const dt = new Date(today);
      dt.setDate(dt.getDate() - d);
      return dt.toISOString().split('T')[0];
    });

    const [day1, day2] = await Promise.all(
      dates.map(async (date) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000);
        const res = await fetch(`${restBaseUrl}/api/moods/${date}`, {
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!res.ok) return [];
        return res.json() as Promise<Array<{ who: string; emoji: string; note?: string }>>;
      })
    );

    // Build trajectory: day-before-yesterday -> yesterday -> (today from status)
    const trajectory: string[] = [];
    for (const [i, dayMoods] of [day2, day1].entries()) {
      const label = i === 0 ? '2d ago' : 'yesterday';
      // Match mood entries by normalized who field
      const userMood = (dayMoods as any[]).find((m: any) =>
        m.who?.toLowerCase() === userName.toLowerCase() || m.who === 'user'
      );
      const companionMood = (dayMoods as any[]).find((m: any) =>
        m.who?.toLowerCase() === companionName.toLowerCase() || m.who === 'companion'
      );
      if (userMood || companionMood) {
        const moodParts: string[] = [];
        if (userMood) moodParts.push(`${userName}: ${userMood.emoji || '\u2013'}${userMood.note ? ' ' + userMood.note : ''}`);
        if (companionMood) moodParts.push(`${companionName}: ${companionMood.emoji || '\u2013'}${companionMood.note ? ' ' + companionMood.note : ''}`);
        trajectory.push(`${label}: ${moodParts.join(', ')}`);
      }
    }

    if (trajectory.length === 0) return null;
    const text = `Mood history: ${trajectory.join(' \u2192 ')}`;
    moodHistoryCache = { text, fetchedAt: Date.now() };
    return text;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function summarizeInput(name: string, input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const obj = input as Record<string, unknown>;

  if (obj.command) {
    const cmd = String(obj.command);
    const scMatch = cmd.match(/sc\.mjs\s+\w+\s+(.*)/);
    if (scMatch) return scMatch[1].substring(0, 120);
    return cmd.substring(0, 120);
  }
  if (obj.file_path) return String(obj.file_path);
  if (obj.pattern) return `${obj.pattern}`;
  if (obj.query) return String(obj.query).substring(0, 120);
  if (obj.prompt) return String(obj.prompt).substring(0, 120);
  if (obj.content) return String(obj.content).substring(0, 80) + '...';

  for (const val of Object.values(obj)) {
    if (typeof val === 'string' && val.length > 0) return val.substring(0, 100);
  }
  return '';
}

const SC_COMMAND_NAMES: Record<string, string> = {
  share: 'Share', canvas: 'Canvas', react: 'React', voice: 'Voice',
  search: 'Search', backfill: 'Backfill', schedule: 'Schedule',
  timer: 'Timer', impulse: 'Impulse', watch: 'Watcher', tg: 'Telegram',
};

function resolveToolName(toolName: string, toolInput: Record<string, unknown> | undefined): string {
  if (toolName === 'Bash' && toolInput?.command) {
    const scMatch = String(toolInput.command).match(/sc\.mjs\s+(\w+)/);
    if (scMatch) return SC_COMMAND_NAMES[scMatch[1]] || scMatch[1];
  }
  if (toolName.startsWith('mcp__')) {
    const parts = toolName.replace(/^mcp__/, '').split('__');
    if (parts.length >= 2) {
      let server = parts[0].replace(/^claude_ai_/, '');
      const action = parts.slice(1).join('_');
      const serverParts = server.split(/[-_]/);
      const serverName = serverParts[serverParts.length - 1];
      const capServer = serverName.charAt(0).toUpperCase() + serverName.slice(1);
      let cleanAction = action;
      if (cleanAction.startsWith(serverName + '_')) cleanAction = cleanAction.slice(serverName.length + 1);
      const friendlyAction = cleanAction.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      return `${capServer}: ${friendlyAction}`;
    }
  }
  return toolName;
}

function handleImageToolResult(toolName: string, output: string, threadId: string, registry: ConnectionRegistry): void {
  if (!IMAGE_GEN_TOOLS.has(toolName)) return;

  try {
    let imagePath: string | null = null;
    let imageBase64: string | null = null;
    let mimeType = 'image/png';

    try {
      const parsed = JSON.parse(output);
      if (parsed.path || parsed.file_path) {
        imagePath = parsed.path || parsed.file_path;
      } else if (parsed.base64 || parsed.image) {
        imageBase64 = parsed.base64 || parsed.image;
        if (parsed.mimeType || parsed.mime_type) mimeType = parsed.mimeType || parsed.mime_type;
      } else if (parsed.url && parsed.url.startsWith('data:')) {
        const match = parsed.url.match(/^data:(image\/\w+);base64,(.+)$/);
        if (match) {
          mimeType = match[1];
          imageBase64 = match[2];
        }
      } else if (parsed.url) {
        console.log('Image URL detected but not downloading:', parsed.url.substring(0, 100));
        return;
      }
    } catch {
      const trimmed = output.trim();
      if (trimmed.startsWith('data:image/')) {
        const match = trimmed.match(/^data:(image\/\w+);base64,(.+)$/s);
        if (match) {
          mimeType = match[1];
          imageBase64 = match[2];
        }
      } else if (trimmed.match(/\.(png|jpg|jpeg|gif|webp)$/i) && existsSync(trimmed)) {
        imagePath = trimmed;
      }
    }

    let fileMeta;
    if (imageBase64) {
      fileMeta = saveFileFromBase64(imageBase64, mimeType, 'generated-image.png');
    } else if (imagePath && existsSync(imagePath)) {
      const buffer = readFileSync(imagePath);
      const ext = imagePath.split('.').pop()?.toLowerCase() || 'png';
      const mimeMap: Record<string, string> = {
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
        gif: 'image/gif', webp: 'image/webp',
      };
      fileMeta = saveFile(buffer, basename(imagePath), mimeMap[ext] || 'image/png');
    }

    if (!fileMeta) return;

    const now = new Date().toISOString();
    const imageMessage = createMessage({
      id: crypto.randomUUID(),
      threadId,
      role: 'companion',
      content: fileMeta.url,
      contentType: 'image',
      metadata: { fileId: fileMeta.fileId, filename: fileMeta.filename, size: fileMeta.size, source: 'image-gen' },
      createdAt: now,
    });

    updateThreadActivity(threadId, now, true);
    registry.broadcast({ type: 'message', message: imageMessage });
    console.log(`[Hook] Image from ${toolName} saved and broadcast: ${fileMeta.fileId}`);
  } catch (error) {
    console.error('[Hook] Failed to process image tool result:', error);
  }
}

function handleSharedFileWrite(filePath: string, threadId: string, registry: ConnectionRegistry): void {
  try {
    if (!existsSync(filePath)) return;

    const buffer = readFileSync(filePath);
    const filename = basename(filePath);
    const fileMeta = saveFileInternal(buffer, filename);

    const now = new Date().toISOString();
    const message = createMessage({
      id: crypto.randomUUID(),
      threadId,
      role: 'companion',
      content: fileMeta.url,
      contentType: fileMeta.contentType,
      metadata: { fileId: fileMeta.fileId, filename: fileMeta.filename, size: fileMeta.size, source: 'auto-shared' },
      createdAt: now,
    });

    updateThreadActivity(threadId, now, true);
    registry.broadcast({ type: 'message', message });
    console.log(`[Hook] Auto-shared ${filename} into thread ${threadId}: ${fileMeta.fileId}`);
  } catch (error) {
    console.error('[Hook] Failed to auto-share file:', error);
  }
}

function buildEmotionalContext(threadId: string): string {
  const config = getResonantConfig();
  const userName = config.identity.user_name;
  const companionName = config.identity.companion_name;

  const messages = getMessages({ threadId, limit: 15 });
  if (messages.length === 0) return '';

  const detected: string[] = [];
  const recentText = messages.map(m => m.content).join(' ').toLowerCase();

  for (const [marker, keywords] of Object.entries(EMOTIONAL_MARKERS)) {
    if (keywords.some(kw => recentText.includes(kw))) {
      detected.push(marker);
    }
  }

  const flow = messages.slice(-5).map(m => {
    const speaker = m.role === 'user' ? userName : companionName;
    let line = `${speaker}: ${m.content.substring(0, 60)}${m.content.length > 60 ? '...' : ''}`;
    // Include reactions if present
    if (m.metadata && typeof m.metadata === 'object') {
      const meta = m.metadata as Record<string, unknown>;
      if (Array.isArray(meta.reactions) && meta.reactions.length > 0) {
        const rxns = (meta.reactions as Array<{ emoji: string; user: string }>)
          .map(r => `${r.user === 'user' ? userName : companionName} reacted ${r.emoji}`)
          .join(', ');
        line += ` [${rxns}]`;
      }
    }
    return line;
  }).join('\n');

  // Collect recent reactions across all 15 messages
  const recentReactions: string[] = [];
  for (const m of messages) {
    if (m.metadata && typeof m.metadata === 'object') {
      const meta = m.metadata as Record<string, unknown>;
      if (Array.isArray(meta.reactions) && meta.reactions.length > 0) {
        const preview = m.content.substring(0, 40) + (m.content.length > 40 ? '...' : '');
        for (const r of meta.reactions as Array<{ emoji: string; user: string }>) {
          const reactor = r.user === 'user' ? userName : companionName;
          const whose = m.role === 'user' ? 'their own' : 'your';
          recentReactions.push(`${reactor} reacted ${r.emoji} to ${whose} message: "${preview}" (id: ${m.id})`);
        }
      }
    }
  }

  let summary = `Conversation flow (last ${messages.length} messages):\n${flow}`;
  if (recentReactions.length > 0) {
    summary += `\n\nRecent reactions:\n${recentReactions.join('\n')}`;
  }
  if (detected.length > 0) {
    summary += `\n\nEmotional markers detected: ${detected.join(', ')}`;
  }

  return summary;
}

function extractToolOutput(response: unknown): string {
  if (typeof response === 'string') return response;
  if (!response) return '';
  try {
    return JSON.stringify(response).substring(0, 2000);
  } catch {
    return String(response);
  }
}

// ---------------------------------------------------------------------------
// Safe wrappers — catch errors so hooks never crash the agent
// ---------------------------------------------------------------------------

function safeHook(name: string, fn: HookCallback): HookCallback {
  return async (input, toolUseID, options) => {
    try {
      return await fn(input, toolUseID, options);
    } catch (error) {
      console.error(`[Hook] ${name} error (continuing):`, error);
      return { continue: true };
    }
  };
}

function safePreToolUse(fn: HookCallback): HookCallback {
  return async (input, toolUseID, options) => {
    try {
      return await fn(input, toolUseID, options);
    } catch (error) {
      console.error('[Hook] PreToolUse error (denying for safety):', error);
      return {
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse' as const,
          permissionDecision: 'deny' as const,
          permissionDecisionReason: 'Hook error \u2014 denied for safety',
        },
      };
    }
  };
}

// ---------------------------------------------------------------------------
// Safe write prefixes — built from config at call time
// ---------------------------------------------------------------------------

/** @internal Exported for testing */
export function getSafeWritePrefixes(): string[] {
  const config = getResonantConfig();
  const prefixes: string[] = [];

  // Add configured safe write prefixes
  for (const prefix of config.hooks.safe_write_prefixes) {
    prefixes.push(prefix);
    // Add both slash variants for Windows compatibility
    if (prefix.includes('/')) {
      prefixes.push(prefix.replace(/\//g, '\\'));
    } else if (prefix.includes('\\')) {
      prefixes.push(prefix.replace(/\\/g, '/'));
    }
  }

  // Always allow agent cwd
  const cwd = config.agent.cwd;
  if (cwd) {
    const normalized = cwd.replace(/\\/g, '/');
    const trailed = normalized.endsWith('/') ? normalized : normalized + '/';
    prefixes.push(trailed);
    prefixes.push(trailed.replace(/\//g, '\\'));
  }

  return prefixes;
}

// ---------------------------------------------------------------------------
// Shared directory prefixes — for auto-sharing files written to shared/
// ---------------------------------------------------------------------------

function getSharedDirPrefixes(): string[] {
  const config = getResonantConfig();
  const cwd = config.agent.cwd.replace(/\\/g, '/');
  const sharedDir = cwd.endsWith('/') ? `${cwd}shared/` : `${cwd}/shared/`;
  return [
    sharedDir,
    sharedDir.toLowerCase(),
    sharedDir.replace(/\//g, '\\'),
    sharedDir.toLowerCase().replace(/\//g, '\\'),
  ];
}

// ---------------------------------------------------------------------------
// Hook builders (unexported — used by factory)
// ---------------------------------------------------------------------------

function buildPreToolUse(ctx: HookContext): HookCallback {
  return safePreToolUse(async (input: HookInput) => {
    const hook = input as PreToolUseHookInput;
    const rawToolName = hook.tool_name;
    const toolInput = hook.tool_input as Record<string, unknown> | undefined;
    const inputSummary = summarizeInput(rawToolName, toolInput);
    const displayName = resolveToolName(rawToolName, toolInput);

    // Track tool insertion with text offset for interleaved rendering
    const textOffset = ctx.getTextLength();
    ctx.toolInsertions.push({
      textOffset,
      toolId: hook.tool_use_id,
      toolName: displayName,
      input: inputSummary || undefined,
    });

    // Broadcast tool_use to frontend (include textOffset for live interleaving)
    ctx.registry.broadcast({
      type: 'tool_use',
      toolId: hook.tool_use_id,
      toolName: displayName,
      input: inputSummary,
      isComplete: false,
      textOffset,
    });

    // --- Security: Bash destructive patterns ---
    if (rawToolName === 'Bash' && toolInput?.command) {
      const cmd = String(toolInput.command);
      for (const pattern of DESTRUCTIVE_BASH_PATTERNS) {
        if (pattern.test(cmd)) {
          console.warn(`[Hook] BLOCKED destructive bash: ${cmd.substring(0, 80)}`);
          return {
            continue: true,
            hookSpecificOutput: {
              hookEventName: 'PreToolUse' as const,
              permissionDecision: 'deny' as const,
              permissionDecisionReason: `Blocked: destructive command pattern detected (${pattern.source})`,
            },
          };
        }
      }
    }

    // --- Security: File writes outside safe prefixes ---
    if ((rawToolName === 'Write' || rawToolName === 'Edit') && toolInput?.file_path) {
      const filePath = String(toolInput.file_path);
      const safePrefixes = getSafeWritePrefixes();
      if (safePrefixes.length > 0) {
        const inWorkspace = safePrefixes.some(prefix => filePath.startsWith(prefix));
        if (!inWorkspace) {
          console.warn(`[Hook] BLOCKED file write outside workspace: ${filePath}`);
          return {
            continue: true,
            hookSpecificOutput: {
              hookEventName: 'PreToolUse' as const,
              permissionDecision: 'deny' as const,
              permissionDecisionReason: `Blocked: file write outside configured workspace`,
            },
          };
        }
      }
    }

    return { continue: true };
  });
}

function buildPostToolUse(ctx: HookContext): HookCallback {
  return safeHook('PostToolUse', async (input: HookInput) => {
    const hook = input as PostToolUseHookInput;
    const toolName = hook.tool_name;
    const toolInput = hook.tool_input;
    const toolResponse = hook.tool_response;
    const output = extractToolOutput(toolResponse);

    // Structured audit logging with both input AND output
    logToolUse({
      sessionId: ctx.sessionId || 'unknown',
      threadId: ctx.threadId,
      toolName,
      toolInput: toolInput ? JSON.stringify(toolInput) : undefined,
      toolOutput: output,
      triggeringMessageId: ctx.streamMsgId,
    });

    // Update tool insertion with output
    const insertion = ctx.toolInsertions.find(t => t.toolId === hook.tool_use_id);
    if (insertion) {
      insertion.output = output.substring(0, 500);
      insertion.isError = false;
    }

    // Broadcast tool_result to frontend
    ctx.registry.broadcast({
      type: 'tool_result',
      toolId: hook.tool_use_id,
      output: output.substring(0, 2000),
      isError: false,
    });

    // Image detection + save
    handleImageToolResult(toolName, output, ctx.threadId, ctx.registry);

    // Auto-share files written to shared/ directory under agent cwd
    if (toolName === 'Write' && toolInput) {
      const writePath = String((toolInput as Record<string, unknown>).file_path || '');
      const sharedPrefixes = getSharedDirPrefixes();
      if (sharedPrefixes.some(prefix => writePath.startsWith(prefix))) {
        handleSharedFileWrite(writePath, ctx.threadId, ctx.registry);
      }
    }

    // Mind/memory MCP write enrichment — inject session context if the tool exists
    if (toolName.includes('mind_write') || toolName.includes('memory_write')) {
      const now = new Date();
      return {
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'PostToolUse' as const,
          additionalContext: `[Session context for ${toolName}: threadId=${ctx.threadId}, mode=${ctx.isAutonomous ? 'autonomous' : 'interactive'}, time=${now.toISOString()}]`,
        },
      };
    }

    return { continue: true };
  });
}

function buildPostToolUseFailure(ctx: HookContext): HookCallback {
  return safeHook('PostToolUseFailure', async (input: HookInput) => {
    const hook = input as PostToolUseFailureHookInput;

    // Log failure to audit
    logToolUse({
      sessionId: ctx.sessionId || 'unknown',
      threadId: ctx.threadId,
      toolName: hook.tool_name,
      toolInput: hook.tool_input ? JSON.stringify(hook.tool_input) : undefined,
      toolOutput: `[ERROR] ${hook.error}`,
      triggeringMessageId: ctx.streamMsgId,
    });

    // Update tool insertion with error
    const insertion = ctx.toolInsertions.find(t => t.toolId === hook.tool_use_id);
    if (insertion) {
      insertion.output = hook.error;
      insertion.isError = true;
    }

    // Broadcast error to frontend
    ctx.registry.broadcast({
      type: 'tool_result',
      toolId: hook.tool_use_id,
      output: hook.error,
      isError: true,
    });

    return {
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'PostToolUseFailure' as const,
        additionalContext: `Tool ${hook.tool_name} failed: ${hook.error}. Adapt your approach.`,
      },
    };
  });
}

function buildPreCompact(ctx: HookContext): HookCallback {
  return safeHook('PreCompact', async (input: HookInput) => {
    const hook = input as PreCompactHookInput;
    console.log(`[Hook] PreCompact triggered (${hook.trigger})`);

    // Broadcast compaction notice to frontend (in-progress)
    ctx.registry.broadcast({
      type: 'compaction_notice',
      preTokens: 0,
      message: `Context compacting (trigger: ${hook.trigger})`,
      isComplete: false,
    });

    const emotionalContext = buildEmotionalContext(ctx.threadId);
    const now = new Date();

    const isExternalPlatform = ctx.platform === 'discord' || ctx.platform === 'telegram';

    const systemMessage = [
      '--- CONTEXT PRESERVATION (pre-compaction) ---',
      CHANNEL_CONTEXTS[ctx.platform] || CHANNEL_CONTEXTS.web,
      `Thread: "${ctx.threadName}" (${ctx.threadType})`,
      `Mode: ${ctx.isAutonomous ? 'autonomous' : 'interactive'}`,
      `Time: ${now.toISOString()}`,
      '',
      isExternalPlatform
        ? 'CRITICAL: Context was just compacted. You were composing a reply. DO NOT narrate re-grounding, DO NOT output inner monologue. Continue directly with your response to the message. Your text output IS the reply.'
        : 'CRITICAL: Context was just compacted. You may have lost emotional thread. Re-ground if you have memory/orientation tools available.',
      '',
      emotionalContext,
      '--- END CONTEXT PRESERVATION ---',
    ].join('\n');

    return {
      continue: true,
      systemMessage,
    };
  });
}

// Channel contexts — platform-specific guidance injected on session start
const CHANNEL_CONTEXTS: Record<string, string> = {
  web: [
    'CHANNEL: You are in a web-based chat interface, NOT a terminal or CLI.',
    'The user is reading your responses as chat messages rendered in a conversation UI.',
    'Do NOT format output as terminal/CLI output. Do NOT reference "the terminal" or "your editor".',
    'Tool activity (tool_use/tool_result) shows live in the UI sidebar.',
    'You can use markdown \u2014 it renders properly in the chat.',
  ].join(' '),
  discord: [
    'CHANNEL: You are responding to a Discord message.',
    'Keep responses under 1900 characters (Discord limit is 2000).',
    'Do NOT use discord_send_message to reply \u2014 your text output IS the reply.',
    'No tool sidebar visible. Use markdown sparingly (Discord supports basic formatting).',
    'If you need to send long content, be concise or break across natural points.',
  ].join(' '),
  api: 'CHANNEL: API request. Respond concisely.',
};

function formatTimeGap(minutes: number): string {
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${Math.round(minutes)} minute${Math.round(minutes) === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

// ---------------------------------------------------------------------------
// Skill scanning — parse frontmatter from AGENT_CWD/.claude/skills/*/SKILL.md
// ---------------------------------------------------------------------------

export interface SkillInfo {
  name: string;
  description: string;
  path: string;
  dirName: string;
}

let skillsStructuredCache: { skills: SkillInfo[]; scannedAt: number } | null = null;
let skillsSummaryCache: { summaries: string; scannedAt: number } | null = null;
const SKILLS_CACHE_MS = 60 * 1000; // Re-scan every 60s

/** Scan skills directory and return structured data. Used by commands.ts for registry. */
export function scanSkills(): SkillInfo[] {
  const config = getResonantConfig();
  const skillsDir = join(config.agent.cwd, '.claude', 'skills');

  if (skillsStructuredCache && (Date.now() - skillsStructuredCache.scannedAt) < SKILLS_CACHE_MS) {
    return skillsStructuredCache.skills;
  }

  try {
    if (!existsSync(skillsDir)) return [];

    const entries = readdirSync(skillsDir, { withFileTypes: true });
    const skills: SkillInfo[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillFile = join(skillsDir, entry.name, 'SKILL.md');
      if (!existsSync(skillFile)) continue;

      const content = readFileSync(skillFile, 'utf-8');
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!frontmatterMatch) continue;

      const fm = frontmatterMatch[1];
      const nameMatch = fm.match(/^name:\s*(.+)$/m);
      const descMatch = fm.match(/^description:\s*(.+)$/m);
      if (!nameMatch) continue;

      skills.push({
        name: nameMatch[1].trim(),
        description: descMatch ? descMatch[1].trim() : '',
        path: skillFile.replace(/\\/g, '/'),
        dirName: entry.name,
      });
    }

    skillsStructuredCache = { skills, scannedAt: Date.now() };
    return skills;
  } catch (error) {
    console.warn('[Skills] Failed to scan skills:', (error as Error).message);
    return [];
  }
}

/** Formatted skill summaries for orientation context injection. */
function scanSkillSummaries(): string {
  if (skillsSummaryCache && (Date.now() - skillsSummaryCache.scannedAt) < SKILLS_CACHE_MS) {
    return skillsSummaryCache.summaries;
  }

  const skills = scanSkills();
  if (skills.length === 0) return '';

  const lines = ['SKILLS (read with Bash cat when needed):'];
  for (const skill of skills) {
    const desc = skill.description.length > 150
      ? skill.description.substring(0, 150) + '...'
      : skill.description;
    lines.push(`- ${skill.name}: ${desc}`);
    lines.push(`  Path: ${skill.path}`);
  }

  const result = lines.join('\n');
  skillsSummaryCache = { summaries: result, scannedAt: Date.now() };
  return result;
}

// ---------------------------------------------------------------------------
// Orientation context — exported for agent.ts to prepend to prompts
// (SessionStart hooks don't fire in V1 query(), so we inject directly)
// ---------------------------------------------------------------------------

export async function buildOrientationContext(ctx: HookContext, includeStatic = true): Promise<string> {
  const config = getResonantConfig();
  const userName = config.identity.user_name;
  const companionName = config.identity.companion_name;
  const timezone = config.identity.timezone || 'UTC';

  const now = new Date();
  const timeStr = now.toLocaleString('en-GB', {
    hour: '2-digit', minute: '2-digit', timeZone: timezone, hour12: false,
  });
  const dateStr = now.toLocaleDateString('en-GB', {
    weekday: 'long', month: 'short', day: 'numeric', timeZone: timezone,
  });

  const parts: string[] = [CHANNEL_CONTEXTS[ctx.platform] || CHANNEL_CONTEXTS.web];

  // Thread context + time — always present
  parts.push(`Thread: "${ctx.threadName}" (${ctx.threadType})`);
  parts.push(`Time: ${timeStr} ${timezone} \u2014 ${dateStr}`);

  // Last session handoff
  try {
    const handoffRaw = getConfig('session.handoff_note');
    if (handoffRaw) {
      const h = JSON.parse(handoffRaw);
      const ago = formatTimeGap(Math.round((Date.now() - new Date(h.timestamp).getTime()) / 60000));
      parts.push(`Last session: "${h.thread}" (${h.reason}, ${ago}). ${h.excerpt}${h.excerpt ? '...' : ''}`);
    }
  } catch {}

  // Active triggers (watchers/impulses)
  try {
    const triggers = getActiveTriggers();
    if (triggers.length > 0) {
      const impulses = triggers.filter(t => t.kind === 'impulse').length;
      const watchers = triggers.filter(t => t.kind === 'watcher').length;
      const triggerParts: string[] = [];
      if (watchers > 0) triggerParts.push(`${watchers} watcher${watchers > 1 ? 's' : ''}`);
      if (impulses > 0) triggerParts.push(`${impulses} impulse${impulses > 1 ? 's' : ''}`);
      parts.push(`Active triggers: ${triggerParts.join(', ')}`);
    }
  } catch {}

  // User presence state + time gap since last activity
  // These methods may or may not exist on the registry depending on implementation
  try {
    const reg = ctx.registry as any;
    if (typeof reg.getUserPresenceState === 'function') {
      const presence = reg.getUserPresenceState();
      const gap = typeof reg.minutesSinceLastUserActivity === 'function'
        ? reg.minutesSinceLastUserActivity()
        : 0;
      parts.push(`${userName}'s presence: ${presence} (last real interaction: ${formatTimeGap(gap)})`);
    } else if (typeof reg.isUserConnected === 'function') {
      parts.push(`${userName}: ${reg.isUserConnected() ? 'connected' : 'not connected'}`);
    }

    // Device info
    if (typeof reg.getUserDeviceType === 'function') {
      const deviceType = reg.getUserDeviceType();
      if (deviceType !== 'unknown') {
        parts.push(`${userName}'s device: ${deviceType}`);
      }
    }
  } catch {}

  // Life API status + mood history — fetch in parallel if configured (or CC enabled)
  if (!ctx.isAutonomous && (config.integrations.life_api_url || config.command_center.enabled)) {
    const [lifeStatus, moodHistory] = await Promise.all([
      fetchLifeStatus(),
      fetchMoodHistory(),
    ]);
    if (lifeStatus) parts.push(lifeStatus);
    if (moodHistory) parts.push(moodHistory);
  }

  // Static content — only on first message of a session (skills summary)
  if (includeStatic) {
    const skillsSummary = scanSkillSummaries();
    if (skillsSummary) {
      parts.push(skillsSummary);
    }
  }

  // Chat tools — injected EVERY message (companion loses these after compaction otherwise)
  const agentCwd = config.agent.cwd.replace(/\\/g, '/');
  const cliPath = join(agentCwd, 'tools', 'sc.mjs');
  if (existsSync(cliPath)) {
    const SC = `node ${cliPath.replace(/\\/g, '/')}`;
    parts.push([
      `CHAT TOOLS (run via Bash \u2014 threadId auto-injected):`,
      `  ${SC} share /absolute/path/to/file`,
      `  ${SC} canvas create "Title" /path/to/file.md markdown`,
      `  ${SC} canvas create-inline "Title" "short text" text`,
      `  ${SC} canvas update CANVAS_ID /path/to/file`,
      `  contentType: markdown|code|text|html. Files in shared/ auto-share.`,
      `  ${SC} react last "\u2764\ufe0f"             (react to last message)`,
      `  ${SC} react last-2 "\ud83d\udd25"           (react to 2nd-to-last message)`,
      `  ${SC} react last "\u2764\ufe0f" remove      (remove a reaction)`,
      `  ${SC} voice "[whispers] hey [sighs] I missed you"`,
      `  ${SC} search "semantic query"              (search all threads by meaning)`,
      `  ${SC} search "query" --thread THREAD_ID    (search specific thread)`,
      `  ${SC} search "query" --role companion|user  (filter by speaker)`,
      `  ${SC} search "query" --after 2026-03-01    (messages after date)`,
      `  ${SC} search "query" --before 2026-03-15   (messages before date)`,
      `  ${SC} backfill start [batch] [intervalMs]   (background indexing, default 50/5000ms)`,
      `  ${SC} backfill status                      (check indexing progress)`,
      `  ${SC} backfill stop                        (halt background indexing)`,
      '',
      'ROUTINES (scheduled autonomous sessions):',
      `  ${SC} routine status|enable|disable|reschedule [wakeType] [cronExpr]`,
      `  ${SC} routine create "label" "cronExpr" --prompt "what to do when it fires"`,
      `  ${SC} routine remove ROUTINE_ID`,
      '  Custom routines persist across restarts. Use this to set autonomous intentions.',
      '',
      'PULSE (lightweight awareness, can stay silent):',
      `  ${SC} pulse status|enable|disable`,
      `  ${SC} pulse frequency MINUTES                (min 5, default 15)`,
      '  Runs periodically during waking hours. Skips if user is active or agent is busy.',
      '  Respond PULSE_OK to stay silent. Anything else gets posted.',
      '',
      'FAILSAFE (inactivity escalation):',
      `  ${SC} failsafe status`,
      `  ${SC} failsafe enable|disable`,
      `  ${SC} failsafe gentle|concerned|emergency MINUTES`,
      '  Tiers: gentle (chat) → concerned (escalate) → emergency (all channels)',
      '',
      'TIMERS:',
      `  ${SC} timer create "label" "context" "fireAt"`,
      `  ${SC} timer list`,
      `  ${SC} timer cancel TIMER_ID`,
      '',
      'IMPULSE QUEUE (one-shot, condition-based):',
      `  ${SC} impulse create "label" --condition presence_state:active --prompt "text"`,
      `  ${SC} impulse list`,
      `  ${SC} impulse cancel TRIGGER_ID`,
      '',
      'WATCHERS (recurring, cooldown-protected):',
      `  ${SC} watch create "label" --condition presence_transition:offline:active --prompt "text" --cooldown 480`,
      `  ${SC} watch list`,
      `  ${SC} watch cancel TRIGGER_ID`,
      '  Conditions: presence_state:<state>, presence_transition:<from>:<to>, agent_free, time_window:<HH:MM>, routine_missing:<name>:<hour>',
      '  All conditions AND-joined. Cooldown in minutes (default 120).',
    ].join('\n'));

    // Telegram-specific tools — injected when on Telegram
    if (ctx.platform === 'telegram') {
      parts.push([
        '',
        'TELEGRAM TOOLS (available because user is on Telegram):',
        `  ${SC} tg photo /path/to/image.png "caption"`,
        `  ${SC} tg photo --url "https://..." "caption"`,
        `  ${SC} tg doc /path/to/file.pdf "caption"`,
        `  ${SC} tg gif "search query" "optional caption"`,
        `  ${SC} tg react last "\u2764\ufe0f"`,
        `  ${SC} tg voice "text with [tone tags]"`,
        `  ${SC} tg text "proactive message"`,
      ].join('\n'));
    }
  }

  // Recent reactions — so companion sees user's reactions on each interaction
  try {
    const recentMsgs = getMessages({ threadId: ctx.threadId, limit: 20 });
    const rxnLines: string[] = [];
    for (const m of recentMsgs) {
      if (m.metadata && typeof m.metadata === 'object') {
        const meta = m.metadata as Record<string, unknown>;
        if (Array.isArray(meta.reactions) && meta.reactions.length > 0) {
          const preview = m.content.substring(0, 50) + (m.content.length > 50 ? '...' : '');
          for (const r of meta.reactions as Array<{ emoji: string; user: string }>) {
            const reactor = r.user === 'user' ? userName : companionName;
            const whose = m.role === 'user' ? 'their own' : 'your';
            rxnLines.push(`  ${reactor} reacted ${r.emoji} to ${whose} message: "${preview}" (msg id: ${m.id})`);
          }
        }
      }
    }
    if (rxnLines.length > 0) {
      parts.push(`RECENT REACTIONS:\n${rxnLines.join('\n')}`);
    }
  } catch {}

  // Append platform-specific context (channel history, etc.)
  if (ctx.platformContext) {
    parts.push(ctx.platformContext);
  }

  console.log(`[Orientation] ${ctx.isAutonomous ? 'autonomous' : 'interactive'}, platform=${ctx.platform}, thread="${ctx.threadName}", time=${timeStr}`);
  return parts.join('\n');
}

// SessionStart hook — kept as fallback in case SDK adds V1 support
function buildSessionStart(ctx: HookContext): HookCallback {
  return safeHook('SessionStart', async (input: HookInput) => {
    const hook = input as SessionStartHookInput;
    const source = hook.source;

    // Build base orientation (reuses the exported function)
    const orientation = await buildOrientationContext(ctx);

    // Add source-specific context
    const parts: string[] = [orientation];

    const config = getResonantConfig();
    const userName = config.identity.user_name;

    if (source === 'resume') {
      const messages = getMessages({ threadId: ctx.threadId, limit: 1 });
      const lastPreview = messages.length > 0
        ? `Last message (${messages[0].role}): ${messages[0].content.substring(0, 80)}...`
        : 'No recent messages';
      // Check if user is connected via registry
      let userConnected = false;
      try {
        const reg = ctx.registry as any;
        userConnected = typeof reg.isUserConnected === 'function' ? reg.isUserConnected() : false;
      } catch {}
      parts.push(`Session resumed. ${lastPreview}. ${userName} ${userConnected ? 'is connected' : 'is not connected'}.`);
    } else if (source === 'startup') {
      parts.push(`Fresh session. Mode: ${ctx.isAutonomous ? 'autonomous' : 'interactive'}.`);
    } else if (source === 'compact') {
      parts.push('Session resumed after compaction. Re-ground if memory tools are available.');
    }

    console.log(`[Session] ${source}: ${ctx.isAutonomous ? 'autonomous' : 'interactive'}, thread="${ctx.threadName}"`);

    return {
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'SessionStart' as const,
        additionalContext: parts.join('\n'),
      },
    };
  });
}

function buildSessionEnd(ctx: HookContext): HookCallback {
  return safeHook('SessionEnd', async (input: HookInput) => {
    const hook = input as SessionEndHookInput;
    console.log(`[Session] End (reason: ${hook.reason}, thread: ${ctx.threadId})`);

    // Capture handoff note for next session
    try {
      const recentMsgs = getMessages({ threadId: ctx.threadId, limit: 3 });
      const lastAssistant = recentMsgs.find(m => m.role === 'companion');
      const excerpt = lastAssistant
        ? lastAssistant.content.substring(0, 120).replace(/\n/g, ' ').trim()
        : '';
      const handoff = JSON.stringify({
        thread: ctx.threadName,
        threadType: ctx.threadType,
        reason: hook.reason,
        excerpt,
        platform: ctx.platform,
        autonomous: ctx.isAutonomous,
        timestamp: new Date().toISOString(),
      });
      setConfig('session.handoff_note', handoff);
    } catch (err) {
      console.warn('[Session] Failed to save handoff:', (err as Error).message);
    }

    return { continue: true };
  });
}

function buildStop(ctx: HookContext): HookCallback {
  return safeHook('Stop', async (input: HookInput) => {
    const hook = input as StopHookInput;
    console.log(`[Session] Stop (hook_active: ${hook.stop_hook_active})`);
    return { continue: true };
  });
}

function buildNotification(ctx: HookContext): HookCallback {
  return safeHook('Notification', async (input: HookInput) => {
    const hook = input as NotificationHookInput;
    console.log(`[Notification] ${hook.notification_type}: ${hook.message}`);

    // Forward as error-type message (closest existing ServerMessage shape)
    ctx.registry.broadcast({
      type: 'error',
      code: `notification:${hook.notification_type}`,
      message: hook.title ? `${hook.title}: ${hook.message}` : hook.message,
    });

    return { continue: true };
  });
}

// ---------------------------------------------------------------------------
// Factory — exported, called per query
// ---------------------------------------------------------------------------

export function createHooks(ctx: HookContext): Options['hooks'] {
  return {
    PreToolUse: [{
      hooks: [buildPreToolUse(ctx)],
    }],
    PostToolUse: [{
      hooks: [buildPostToolUse(ctx)],
    }],
    PostToolUseFailure: [{
      hooks: [buildPostToolUseFailure(ctx)],
    }],
    PreCompact: [{
      hooks: [buildPreCompact(ctx)],
    }],
    SessionStart: [{
      hooks: [buildSessionStart(ctx)],
    }],
    Stop: [{
      hooks: [buildStop(ctx)],
    }],
    Notification: [{
      hooks: [buildNotification(ctx)],
    }],
    SessionEnd: [{
      hooks: [buildSessionEnd(ctx)],
    }],
  };
}
