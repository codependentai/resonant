#!/usr/bin/env node
// sc — Resonant internal API CLI
// Wraps localhost curl calls into clean commands.
// Thread ID read from .resonant-thread (written per-query by agent.ts)

import { readFileSync } from 'fs';
import { dirname, isAbsolute, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

function readPortFromConfig(configPath) {
  try {
    const yaml = readFileSync(configPath, 'utf8');
    const match = yaml.match(/^\s*port:\s*(\d+)/m);
    if (match) return match[1];
  } catch {}
  return null;
}

// Resolve port: check env, active config, then default config, fallback to 3002
function getPort() {
  if (process.env.RESONANT_PORT) return process.env.RESONANT_PORT;

  if (process.env.RESONANT_CONFIG) {
    const configPath = isAbsolute(process.env.RESONANT_CONFIG)
      ? process.env.RESONANT_CONFIG
      : resolve(PROJECT_ROOT, process.env.RESONANT_CONFIG);
    const configuredPort = readPortFromConfig(configPath);
    if (configuredPort) return configuredPort;
  }

  const defaultPort = readPortFromConfig(join(PROJECT_ROOT, 'resonant.yaml'));
  if (defaultPort) return defaultPort;

  return '3002';
}

const BASE = `http://localhost:${getPort()}/api/internal`;

function getThread() {
  if (process.env.RESONANT_THREAD) return process.env.RESONANT_THREAD;
  try {
    return readFileSync(join(PROJECT_ROOT, '.resonant-thread'), 'utf8').trim();
  } catch {
    return '';
  }
}

async function post(endpoint, body, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const text = await res.text();
    try { console.log(JSON.stringify(JSON.parse(text), null, 2)); }
    catch { console.log(text); }
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') {
      console.error('Error: request timed out');
    } else {
      console.error(`Error: ${e.message}`);
    }
    process.exit(1);
  }
}

const [,, cmd, ...args] = process.argv;
const thread = getThread();

switch (cmd) {
  case 'share':
    await post('share', { path: args[0], threadId: thread });
    break;

  case 'canvas': {
    const sub = args[0];
    if (sub === 'create') {
      await post('canvas', {
        action: 'create', title: args[1], filePath: args[2],
        contentType: args[3] || 'markdown', threadId: thread,
      });
    } else if (sub === 'create-inline') {
      await post('canvas', {
        action: 'create', title: args[1], content: args[2],
        contentType: args[3] || 'text', threadId: thread,
      });
    } else if (sub === 'update') {
      await post('canvas', { action: 'update', canvasId: args[1], filePath: args[2] });
    } else {
      console.log('Usage: sc canvas create|create-inline|update ...');
    }
    break;
  }

  case 'voice':
    await post('tts', { text: args[0], threadId: thread });
    break;

  case 'routine':
  case 'schedule': {
    const sub = args[0];
    if (sub === 'create') {
      const label = args[1];
      const cronExpr = args[2];
      if (!label || !cronExpr) { console.log('Usage: sc routine create "label" "cronExpr" --prompt "what to do"'); break; }
      const wakeType = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      let prompt = undefined;
      const pi = args.indexOf('--prompt');
      if (pi !== -1 && args[pi + 1]) prompt = args[pi + 1];
      await post('orchestrator', { action: 'create_routine', wakeType, label, cronExpr, prompt });
    } else if (sub === 'remove') {
      if (!args[1]) { console.log('Usage: sc routine remove ROUTINE_ID'); break; }
      await post('orchestrator', { action: 'remove_routine', wakeType: args[1] });
    } else {
      const body = { action: sub };
      if (args[1]) body.wakeType = args[1];
      if (args[2]) body.cronExpr = args[2];
      await post('orchestrator', body);
    }
    break;
  }

  case 'pulse': {
    const sub = args[0];
    if (!sub || sub === 'status') {
      await post('orchestrator', { action: 'pulse_status' });
    } else if (sub === 'enable') {
      await post('orchestrator', { action: 'pulse_config', enabled: true });
    } else if (sub === 'disable') {
      await post('orchestrator', { action: 'pulse_config', enabled: false });
    } else if (sub === 'frequency') {
      const minutes = parseInt(args[1], 10);
      if (isNaN(minutes) || minutes < 5) { console.log('Usage: sc pulse frequency MINUTES (min 5)'); break; }
      await post('orchestrator', { action: 'pulse_config', frequency: minutes });
    } else {
      console.log('Usage: sc pulse [status|enable|disable|frequency MINUTES]');
    }
    break;
  }

  case 'failsafe': {
    const sub = args[0];
    if (!sub || sub === 'status') {
      await post('orchestrator', { action: 'failsafe_status' });
    } else if (sub === 'enable') {
      await post('orchestrator', { action: 'failsafe_config', enabled: true });
    } else if (sub === 'disable') {
      await post('orchestrator', { action: 'failsafe_config', enabled: false });
    } else if (['gentle', 'concerned', 'emergency'].includes(sub)) {
      const minutes = parseInt(args[1], 10);
      if (isNaN(minutes)) { console.log(`Usage: sc failsafe ${sub} MINUTES`); break; }
      await post('orchestrator', { action: 'failsafe_config', [sub]: minutes });
    } else {
      console.log('Usage: sc failsafe [status|enable|disable|gentle|concerned|emergency] [minutes]');
    }
    break;
  }

  case 'timer': {
    const sub = args[0];
    if (sub === 'create') {
      const body = {
        action: 'create', label: args[1], context: args[2],
        fireAt: args[3], threadId: thread,
      };
      const pi = args.indexOf('--prompt');
      if (pi !== -1 && args[pi + 1]) body.prompt = args[pi + 1];
      await post('timer', body);
    } else if (sub === 'list') {
      await post('timer', { action: 'list' });
    } else if (sub === 'cancel') {
      await post('timer', { action: 'cancel', timerId: args[1] });
    } else {
      console.log('Usage: sc timer create|list|cancel ...');
    }
    break;
  }

  case 'react':
    if (!args[0] || !args[1]) {
      console.log('Usage: sc react <last|last-N> <emoji> [remove]');
    } else {
      const body = { target: args[0], emoji: args[1], threadId: thread };
      if (args[2] === 'remove') body.action = 'remove';
      await post('react', body);
    }
    break;

  case 'impulse': {
    const sub = args[0];
    if (sub === 'create') {
      const label = args[1];
      if (!label) { console.log('Usage: sc impulse create "label" --condition type:args --prompt "text"'); break; }
      const conditions = [];
      let prompt = undefined;
      let i = 2;
      while (i < args.length) {
        if (args[i] === '--condition' && args[i + 1]) {
          conditions.push(parseCondition(args[i + 1]));
          i += 2;
        } else if (args[i] === '--prompt' && args[i + 1]) {
          prompt = args[i + 1];
          i += 2;
        } else { i++; }
      }
      if (conditions.length === 0) { console.log('At least one --condition required'); break; }
      await post('trigger', { action: 'create', kind: 'impulse', label, conditions, prompt, threadId: thread });
    } else if (sub === 'list') {
      await post('trigger', { action: 'list', kind: 'impulse' });
    } else if (sub === 'cancel') {
      await post('trigger', { action: 'cancel', triggerId: args[1] });
    } else {
      console.log('Usage: sc impulse create|list|cancel ...');
    }
    break;
  }

  case 'watch': {
    const sub = args[0];
    if (sub === 'create') {
      const label = args[1];
      if (!label) { console.log('Usage: sc watch create "label" --condition type:args --prompt "text" --cooldown N'); break; }
      const conditions = [];
      let prompt = undefined;
      let cooldownMinutes = undefined;
      let i = 2;
      while (i < args.length) {
        if (args[i] === '--condition' && args[i + 1]) {
          conditions.push(parseCondition(args[i + 1]));
          i += 2;
        } else if (args[i] === '--prompt' && args[i + 1]) {
          prompt = args[i + 1];
          i += 2;
        } else if (args[i] === '--cooldown' && args[i + 1]) {
          cooldownMinutes = args[i + 1];
          i += 2;
        } else { i++; }
      }
      if (conditions.length === 0) { console.log('At least one --condition required'); break; }
      await post('trigger', { action: 'create', kind: 'watcher', label, conditions, prompt, threadId: thread, cooldownMinutes });
    } else if (sub === 'list') {
      await post('trigger', { action: 'list', kind: 'watcher' });
    } else if (sub === 'cancel') {
      await post('trigger', { action: 'cancel', triggerId: args[1] });
    } else {
      console.log('Usage: sc watch create|list|cancel ...');
    }
    break;
  }

  case 'tg': {
    const sub = args[0];
    if (!sub) { console.log('Usage: sc tg photo|doc|gif|voice|text ...'); break; }

    const typeMap = { photo: 'photo', doc: 'document', voice: 'voice', text: 'text', gif: 'gif', react: 'react' };
    const type = typeMap[sub];
    if (!type) { console.log(`Unknown tg type: ${sub}. Use photo, doc, gif, voice, text, or react.`); break; }

    if (type === 'voice' || type === 'text') {
      await post('telegram-send', { type, text: args[1] }, 30000);
    } else if (type === 'gif') {
      await post('telegram-send', { type: 'gif', query: args[1], caption: args[2] }, 30000);
    } else if (type === 'react') {
      await post('telegram-send', { type: 'react', target: args[1], emoji: args[2] }, 10000);
    } else {
      let source, caption;
      if (args[1] === '--url') {
        source = { url: args[2] };
        caption = args[3];
      } else {
        source = { path: args[1] };
        caption = args[2];
      }
      const body = { type, caption };
      if (source.url) body.url = source.url;
      if (source.path) body.path = source.path;
      if (type === 'document') body.filename = args[1] ? args[1].split('/').pop().split('\\').pop() : 'file';
      await post('telegram-send', body, 30000);
    }
    break;
  }

  case 'search': {
    // sc search "query" --thread ID --limit N --role companion|user --after 2026-03-01 --before 2026-03-15
    const query = args[0];
    if (!query) { console.log('Usage: sc search "query" [--thread ID] [--limit N] [--role companion|user] [--after ISO] [--before ISO]'); break; }
    const body = { query };
    const flags = ['--thread', '--limit', '--role', '--after', '--before'];
    for (const flag of flags) {
      const fi = args.indexOf(flag);
      if (fi !== -1 && args[fi + 1]) {
        const key = flag.replace('--', '');
        body[key] = key === 'limit' ? parseInt(args[fi + 1], 10) : args[fi + 1];
      }
    }
    await post('search-semantic', body, 30000);
    break;
  }

  case 'backfill': {
    const sub = args[0];
    if (sub === 'start') {
      const batchSize = args[1] ? parseInt(args[1], 10) : 50;
      const intervalMs = args[2] ? parseInt(args[2], 10) : 5000;
      await post('embed-backfill', { background: true, batchSize, intervalMs }, 10000);
    } else if (sub === 'stop') {
      await post('embed-backfill', { action: 'stop' }, 10000);
    } else if (sub === 'status') {
      await post('embed-backfill', { action: 'status' }, 10000);
    } else {
      const batchSize = sub ? parseInt(sub, 10) : 50;
      await post('embed-backfill', { batchSize }, 120000);
    }
    break;
  }

  default:
    console.log('sc — Resonant internal API CLI');
    console.log('Commands: share, canvas, voice, routine (schedule), pulse, failsafe, timer, react, impulse, watch, tg, search, backfill');
    break;
}

// --- Condition shorthand parser ---
function parseCondition(shorthand) {
  if (shorthand === 'agent_free') return { type: 'agent_free' };

  const parts = shorthand.split(':');
  const type = parts[0];

  switch (type) {
    case 'presence_state':
      return { type: 'presence_state', state: parts[1] };
    case 'presence_transition':
      return { type: 'presence_transition', from: parts[1], to: parts[2] };
    case 'time_window':
      if (parts.length >= 5) {
        return { type: 'time_window', after: `${parts[1]}:${parts[2]}`, before: `${parts[3]}:${parts[4]}` };
      }
      return { type: 'time_window', after: `${parts[1]}:${parts[2]}` };
    case 'routine_missing':
      return { type: 'routine_missing', routine: parts[1], after_hour: parseInt(parts[2], 10) };
    default:
      console.error(`Unknown condition type: ${type}`);
      process.exit(1);
  }
}
