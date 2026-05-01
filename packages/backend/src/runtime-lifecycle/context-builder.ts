import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { getResonantConfig } from '../config.js';
import { getActiveTriggers, getConfig, getMessages } from '../services/db.js';
import { buildCliToolInstructions } from '../tools/internal-registry.js';
import type { RuntimeLifecycleContext } from './types.js';

const LIFE_STATUS_CACHE_MS = 5 * 60 * 1000;
const MOOD_HISTORY_CACHE_MS = 30 * 60 * 1000;
const SKILLS_CACHE_MS = 60 * 1000;

let lifeStatusCache: { text: string; fetchedAt: number } | null = null;
let moodHistoryCache: { text: string; fetchedAt: number } | null = null;
let skillsStructuredCache: { skills: SkillInfo[]; scannedAt: number } | null = null;
let skillsSummaryCache: { summaries: string; scannedAt: number } | null = null;

export const CHANNEL_CONTEXTS: Record<string, string> = {
  web: [
    'CHANNEL: You are in a web-based chat interface, NOT a terminal or CLI.',
    'The user is reading your responses as chat messages rendered in a conversation UI.',
    'Do NOT format output as terminal/CLI output. Do NOT reference "the terminal" or "your editor".',
    'Tool activity (tool_use/tool_result) shows live in the UI sidebar.',
    'You can use markdown; it renders properly in the chat.',
  ].join(' '),
  discord: [
    'CHANNEL: You are responding to a Discord message.',
    'Keep responses under 1900 characters (Discord limit is 2000).',
    'Do NOT use discord_send_message to reply; your text output IS the reply.',
    'No tool sidebar visible. Use markdown sparingly (Discord supports basic formatting).',
    'If you need to send long content, be concise or break across natural points.',
  ].join(' '),
  telegram: [
    'CHANNEL: You are responding to a Telegram message.',
    'Keep responses compact and readable on mobile.',
    'Your text output IS the reply unless you intentionally use a Telegram tool.',
  ].join(' '),
  api: 'CHANNEL: API request. Respond concisely.',
};

export interface SkillInfo {
  name: string;
  description: string;
  path: string;
  dirName: string;
}

export async function fetchLifeStatus(): Promise<string> {
  const config = getResonantConfig();
  const lifeApiUrl = config.integrations.life_api_url;

  if (!lifeApiUrl && config.command_center.enabled) {
    if (lifeStatusCache && (Date.now() - lifeStatusCache.fetchedAt) < LIFE_STATUS_CACHE_MS) {
      return lifeStatusCache.text;
    }
    try {
      const { getCcStatus } = await import('../services/cc.js');
      const rawText = getCcStatus();
      lifeStatusCache = { text: rawText, fetchedAt: Date.now() };
      return rawText;
    } catch (e) {
      console.warn('[Context] CC status error:', (e as Error).message);
      return '';
    }
  }

  if (!lifeApiUrl) return '';
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
      console.warn(`[Context] Life status fetch failed: ${res.status}`);
      return '';
    }

    const json = await res.json() as any;
    const rawText = json?.result?.content?.[0]?.text || '';
    const condensed = condenseLifeStatus(rawText);
    lifeStatusCache = { text: condensed, fetchedAt: Date.now() };
    return condensed;
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      console.warn('[Context] Life status fetch timed out (2s)');
    } else {
      console.warn('[Context] Life status fetch error:', (error as Error).message);
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

  const userParts: string[] = [];
  const userMoodRegex = new RegExp(`\\*\\*${escapeRegExp(userName)}:\\*\\*\\s*(.+?)(?:\\n|$)`);
  const userMoodMatch = markdown.match(userMoodRegex);
  if (userMoodMatch) {
    const mood = userMoodMatch[1].trim();
    if (mood && mood !== '-' && mood.charCodeAt(0) !== 8211) userParts.push(`Mood ${mood}`);
  }

  const routineSection = markdown.match(/## Today's Routines\n([\s\S]*?)(?:\n##|\n\n##|$)/);
  if (routineSection) {
    const routineItems: string[] = [];
    const routineLines = routineSection[1].split('\n').filter(l => l.startsWith('- '));
    for (const line of routineLines) {
      const match = line.match(/^-\s+(.+?):\s+(.+)$/);
      if (!match) continue;
      const name = match[1].trim().toLowerCase();
      const val = match[2].trim();
      if (val === '-' || val.charCodeAt(0) === 8211) routineItems.push(`${name}: no`);
      else if (val.toLowerCase() === 'yes') routineItems.push(`${name}: yes`);
      else routineItems.push(`${name}: ${val}`);
    }
    if (routineItems.length > 0) userParts.push(`Routines: ${routineItems.join(', ')}`);
  }

  const cycleSection = markdown.match(/## Cycle\n([\s\S]*?)(?:\n##|$)/);
  if (cycleSection) {
    const cycleText = cycleSection[1].trim();
    if (cycleText) userParts.push(`Cycle: ${cycleText.split('\n')[0]}`);
  }

  if (userParts.length > 0) lines.push(`${userName}: ${userParts.join('. ')}`);

  const companionMoodRegex = new RegExp(`\\*\\*${escapeRegExp(companionName)}:\\*\\*\\s*(.+?)(?:\\n|$)`);
  const companionMoodMatch = markdown.match(companionMoodRegex);
  if (companionMoodMatch) {
    const mood = companionMoodMatch[1].trim();
    if (mood && mood !== '-' && mood.charCodeAt(0) !== 8211) lines.push(`${companionName}: Mood ${mood}`);
  }

  const taskSection = markdown.match(/## Active Tasks\n([\s\S]*?)(?:\n##|$)/);
  if (taskSection) {
    const taskLines = taskSection[1].split('\n').filter(l => l.startsWith('- '));
    if (taskLines.length > 0) lines.push(`Tasks: ${taskLines.length} active`);
  }

  const countdownSection = markdown.match(/## Countdowns\n([\s\S]*?)(?:\n##|$)/);
  if (countdownSection) {
    const firstCountdown = countdownSection[1].trim().split('\n')[0];
    if (firstCountdown && firstCountdown.startsWith('-')) {
      lines.push(firstCountdown.replace(/^-\s*/, '').trim());
    }
  }

  return lines.join('\n');
}

async function fetchMoodHistory(): Promise<string | null> {
  const config = getResonantConfig();
  const lifeApiUrl = config.integrations.life_api_url;

  if (!lifeApiUrl && config.command_center.enabled) {
    if (moodHistoryCache && (Date.now() - moodHistoryCache.fetchedAt) < MOOD_HISTORY_CACHE_MS) {
      return moodHistoryCache.text;
    }
    try {
      const { getCareEntries } = await import('../services/cc.js');
      const today = new Date();
      const trajectory: string[] = [];

      for (const daysAgo of [2, 1]) {
        const dt = new Date(today);
        dt.setDate(dt.getDate() - daysAgo);
        const dateStr = dt.toISOString().split('T')[0];
        const entries = getCareEntries(dateStr);
        const moodEntries = entries.filter((e: any) => e.category === 'mood' && e.value);
        if (moodEntries.length === 0) continue;
        const label = daysAgo === 1 ? 'yesterday' : `${daysAgo}d ago`;
        const moodParts = moodEntries.map((m: any) => {
          const name = (m.person || 'user').charAt(0).toUpperCase() + (m.person || 'user').slice(1);
          return `${name}: ${m.value}${m.note ? ' ' + m.note : ''}`;
        });
        trajectory.push(`${label}: ${moodParts.join(', ')}`);
      }

      if (trajectory.length === 0) return null;
      const text = `Mood history: ${trajectory.join(' -> ')}`;
      moodHistoryCache = { text, fetchedAt: Date.now() };
      return text;
    } catch {
      return null;
    }
  }

  if (!lifeApiUrl) return null;
  if (moodHistoryCache && (Date.now() - moodHistoryCache.fetchedAt) < MOOD_HISTORY_CACHE_MS) {
    return moodHistoryCache.text;
  }

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
        const res = await fetch(`${restBaseUrl}/api/moods/${date}`, { signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok) return [];
        return res.json() as Promise<Array<{ who: string; emoji: string; note?: string }>>;
      }),
    );

    const trajectory: string[] = [];
    for (const [i, dayMoods] of [day2, day1].entries()) {
      const label = i === 0 ? '2d ago' : 'yesterday';
      const userMood = (dayMoods as any[]).find((m: any) =>
        m.who?.toLowerCase() === userName.toLowerCase() || m.who === 'user');
      const companionMood = (dayMoods as any[]).find((m: any) =>
        m.who?.toLowerCase() === companionName.toLowerCase() || m.who === 'companion');
      if (!userMood && !companionMood) continue;
      const moodParts: string[] = [];
      if (userMood) moodParts.push(`${userName}: ${userMood.emoji || '-'}${userMood.note ? ' ' + userMood.note : ''}`);
      if (companionMood) moodParts.push(`${companionName}: ${companionMood.emoji || '-'}${companionMood.note ? ' ' + companionMood.note : ''}`);
      trajectory.push(`${label}: ${moodParts.join(', ')}`);
    }

    if (trajectory.length === 0) return null;
    const text = `Mood history: ${trajectory.join(' -> ')}`;
    moodHistoryCache = { text, fetchedAt: Date.now() };
    return text;
  } catch {
    return null;
  }
}

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

function formatTimeGap(minutes: number): string {
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${Math.round(minutes)} minute${Math.round(minutes) === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function buildOrientationContext(
  ctx: RuntimeLifecycleContext,
  includeStatic = true,
): Promise<string> {
  const config = getResonantConfig();
  const userName = config.identity.user_name;
  const companionName = config.identity.companion_name;
  const timezone = config.identity.timezone || 'UTC';

  const now = new Date();
  const timeStr = now.toLocaleString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
    hour12: false,
  });
  const dateStr = now.toLocaleDateString('en-GB', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: timezone,
  });

  const parts: string[] = [CHANNEL_CONTEXTS[ctx.platform] || CHANNEL_CONTEXTS.web];
  parts.push(`Thread: "${ctx.threadName}" (${ctx.threadType})`);
  parts.push(`Time: ${timeStr} ${timezone} - ${dateStr}`);

  try {
    const handoffRaw = getConfig('session.handoff_note');
    if (handoffRaw) {
      const h = JSON.parse(handoffRaw);
      const ago = formatTimeGap(Math.round((Date.now() - new Date(h.timestamp).getTime()) / 60000));
      parts.push(`Last session: "${h.thread}" (${h.reason}, ${ago}). ${h.excerpt}${h.excerpt ? '...' : ''}`);
    }
  } catch {}

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

    if (typeof reg.getUserDeviceType === 'function') {
      const deviceType = reg.getUserDeviceType();
      if (deviceType !== 'unknown') parts.push(`${userName}'s device: ${deviceType}`);
    }
  } catch {}

  if (!ctx.isAutonomous && (config.integrations.life_api_url || config.command_center.enabled)) {
    const [lifeStatus, moodHistory] = await Promise.all([fetchLifeStatus(), fetchMoodHistory()]);
    if (lifeStatus) parts.push(lifeStatus);
    if (moodHistory) parts.push(moodHistory);
  }

  if (includeStatic) {
    const skillsSummary = scanSkillSummaries();
    if (skillsSummary) parts.push(skillsSummary);
  }

  const agentCwd = config.agent.cwd.replace(/\\/g, '/');
  const cliPath = join(agentCwd, 'tools', 'sc.mjs');
  if (existsSync(cliPath)) {
    const scCommand = `node ${cliPath.replace(/\\/g, '/')}`;
    parts.push(buildCliToolInstructions(scCommand, ctx.platform));
  }

  try {
    const recentMsgs = getMessages({ threadId: ctx.threadId, limit: 20 });
    const rxnLines: string[] = [];
    for (const m of recentMsgs) {
      if (!m.metadata || typeof m.metadata !== 'object') continue;
      const meta = m.metadata as Record<string, unknown>;
      if (!Array.isArray(meta.reactions) || meta.reactions.length === 0) continue;
      const preview = m.content.substring(0, 50) + (m.content.length > 50 ? '...' : '');
      for (const r of meta.reactions as Array<{ emoji: string; user: string }>) {
        const reactor = r.user === 'user' ? userName : companionName;
        const whose = m.role === 'user' ? 'their own' : 'your';
        rxnLines.push(`  ${reactor} reacted ${r.emoji} to ${whose} message: "${preview}" (msg id: ${m.id})`);
      }
    }
    if (rxnLines.length > 0) parts.push(`RECENT REACTIONS:\n${rxnLines.join('\n')}`);
  } catch {}

  if (ctx.platformContext) parts.push(ctx.platformContext);

  console.log(`[Orientation] ${ctx.isAutonomous ? 'autonomous' : 'interactive'}, platform=${ctx.platform}, thread="${ctx.threadName}", time=${timeStr}`);
  return parts.join('\n');
}
