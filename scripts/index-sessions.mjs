#!/usr/bin/env node

/**
 * Session Indexer — reconstructs session lineage and builds sessions-index.json
 *
 * The Claude Agent SDK creates a new .jsonl session file for every query() call,
 * even when resuming. This leaves orphan files that are actually valid history.
 *
 * Two-pass approach with convergence:
 *   Pass 1: Index files with user messages (reliable Thread: "name" match)
 *   Pass 2: Link snapshot-only files to nearest matched session by timestamp
 *   Convergence: Iterate until no new matches
 *
 * Also backfills the session_history table for proper chain tracking.
 * Safe to run repeatedly (idempotent). Designed for daily cron.
 *
 * Usage:
 *   node scripts/index-sessions.mjs
 *
 * Environment:
 *   DB_PATH     — path to SQLite database (default: ./data/resonant.db)
 *   AGENT_CWD   — companion's working directory (used to find SDK sessions)
 */

import Database from 'better-sqlite3';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// --- Config ---
const DB_PATH = process.env.DB_PATH || join(import.meta.dirname, '..', 'data', 'resonant.db');
const AGENT_CWD = process.env.AGENT_CWD || process.cwd();

function encodeCwd(cwd) {
  return cwd.replace(/\//g, '\\').replace(/[^a-zA-Z0-9]/g, '-');
}
const SESSIONS_DIR = join(homedir(), '.claude', 'projects', encodeCwd(AGENT_CWD));
const INDEX_PATH = join(SESSIONS_DIR, 'sessions-index.json');

function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').replace('Z', '');
  console.log(`${ts}  [session-indexer] ${msg}`);
}

function run() {
  if (!existsSync(SESSIONS_DIR)) {
    log(`Sessions directory not found: ${SESSIONS_DIR}`);
    log('This is normal if no sessions have been created yet.');
    process.exit(0);
  }

  const db = new Database(DB_PATH, { readonly: false });
  db.pragma('journal_mode = WAL');

  // Ensure session_history supports 'resumed' end_reason
  const shCount = db.prepare('SELECT COUNT(*) as c FROM session_history').get().c;
  if (shCount === 0) {
    let needsRecreate = false;
    try {
      db.prepare("INSERT INTO session_history (id, thread_id, session_id, session_type, started_at, end_reason) VALUES ('__test', '__test', '__test', 'v1', '2026-01-01', 'resumed')").run();
      db.prepare("DELETE FROM session_history WHERE id = '__test'").run();
    } catch { needsRecreate = true; }
    if (needsRecreate) {
      db.exec('DROP TABLE session_history');
      db.exec(`CREATE TABLE session_history (
        id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, session_id TEXT NOT NULL UNIQUE,
        session_type TEXT NOT NULL CHECK(session_type IN ('v1', 'v2')),
        started_at TEXT NOT NULL, ended_at TEXT,
        end_reason TEXT CHECK(end_reason IN ('compaction', 'reaper', 'daily_rotation', 'error', 'manual', 'resumed')),
        tokens_used INTEGER, cost_usd REAL, peak_memory_mb INTEGER,
        FOREIGN KEY (thread_id) REFERENCES threads(id)
      )`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_session_history_thread_id ON session_history(thread_id)');
      log('Recreated session_history table with updated constraints');
    }
  }

  // Load existing index
  let existingIndex = { version: 2, sessions: {}, lastRun: null };
  if (existsSync(INDEX_PATH)) {
    try { existingIndex = JSON.parse(readFileSync(INDEX_PATH, 'utf-8')); } catch {}
  }

  // Thread data
  const threads = db.prepare('SELECT id, name, type, current_session_id, session_type, created_at, last_activity_at FROM threads').all();
  const threadBySessionId = new Map();
  const threadByName = new Map();
  for (const t of threads) {
    if (t.current_session_id) threadBySessionId.set(t.current_session_id, t);
    if (!threadByName.has(t.name) || t.last_activity_at > threadByName.get(t.name).last_activity_at) {
      threadByName.set(t.name, t);
    }
  }

  const historyBySessionId = new Map();
  for (const h of db.prepare('SELECT session_id, thread_id FROM session_history').all()) {
    historyBySessionId.set(h.session_id, h);
  }

  const insertHistory = db.prepare(
    'INSERT OR IGNORE INTO session_history (id, thread_id, session_id, session_type, started_at, ended_at, end_reason) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );

  const files = readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.jsonl'));
  log(`Found ${files.length} session files`);

  if (files.length === 0) {
    log('Nothing to index.');
    db.close();
    return;
  }

  const index = { version: 2, sessions: {}, lastRun: new Date().toISOString() };
  const deferredSnapshots = [];
  let stats = { cached: 0, current: 0, history: 0, threadName: 0, content: 0, snapshot: 0, unmatched: 0 };

  // === PASS 1 ===
  for (const file of files) {
    const sessionId = file.replace('.jsonl', '');
    const filePath = join(SESSIONS_DIR, file);
    const stat = statSync(filePath);

    const cached = existingIndex.sessions?.[sessionId];
    if (cached && cached.mtime === stat.mtime.toISOString() && cached.threadId) {
      index.sessions[sessionId] = cached;
      stats.cached++;
      continue;
    }

    const meta = extractMeta(filePath, stat);
    let threadId = null, threadName = null, matchSource = null;

    if (threadBySessionId.has(sessionId)) {
      const t = threadBySessionId.get(sessionId);
      threadId = t.id; threadName = t.name; matchSource = 'current'; stats.current++;
    }

    if (!threadId && historyBySessionId.has(sessionId)) {
      const h = historyBySessionId.get(sessionId);
      threadId = h.thread_id;
      threadName = threads.find(t => t.id === threadId)?.name || null;
      matchSource = 'history'; stats.history++;
    }

    if (!threadId && meta.threadNameHint) {
      const candidates = threads.filter(t => t.name === meta.threadNameHint);
      if (candidates.length === 1) {
        threadId = candidates[0].id; threadName = candidates[0].name;
      } else if (candidates.length > 1 && meta.mtime) {
        const fileTime = new Date(meta.mtime).getTime();
        let best = null, bestDist = Infinity;
        for (const c of candidates) {
          const created = new Date(c.created_at).getTime();
          const lastAct = c.last_activity_at ? new Date(c.last_activity_at).getTime() : created;
          if (fileTime >= created - 3600000 && fileTime <= lastAct + 3600000) {
            const dist = Math.abs(fileTime - (created + lastAct) / 2);
            if (dist < bestDist) { bestDist = dist; best = c; }
          }
        }
        if (best) { threadId = best.id; threadName = best.name; }
      }
      if (threadId) { matchSource = 'thread_name'; stats.threadName++; }
    }

    if (!threadId && meta.hasUserMessages) {
      try {
        const content = readFileSync(filePath, 'utf-8');
        for (const t of threads) {
          if (content.includes(t.id)) {
            threadId = t.id; threadName = t.name; matchSource = 'content'; stats.content++;
            break;
          }
        }
      } catch {}
    }

    if (!threadId && !meta.hasUserMessages) {
      deferredSnapshots.push({ sessionId, filePath, stat, meta });
      continue;
    }

    writeEntry(index, sessionId, threadId, threadName, matchSource, meta, stat, threadBySessionId.has(sessionId));
    if (!threadId) stats.unmatched++;
  }

  // === PASS 2 ===
  const timeline = [];
  for (const [sid, entry] of Object.entries(index.sessions)) {
    if (entry.threadId) timeline.push({ sessionId: sid, threadId: entry.threadId, threadName: entry.threadName, mtime: new Date(entry.mtime).getTime() });
  }
  timeline.sort((a, b) => a.mtime - b.mtime);

  for (const snap of deferredSnapshots) {
    const snapTime = snap.stat.mtime.getTime();
    let threadId = null, threadName = null;
    let bestDist = 4 * 60 * 60 * 1000;
    for (const a of timeline) {
      const dist = Math.abs(snapTime - a.mtime);
      if (dist < bestDist) { bestDist = dist; threadId = a.threadId; threadName = a.threadName; }
    }
    if (threadId) stats.snapshot++;
    else stats.unmatched++;
    writeEntry(index, snap.sessionId, threadId, threadName, threadId ? 'snapshot_proximity' : null, snap.meta, snap.stat, false);
  }

  // === CONVERGENCE ===
  let convergeRound = 0;
  while (true) {
    const anchors = [];
    for (const [sid, entry] of Object.entries(index.sessions)) {
      if (entry.threadId) anchors.push({ threadId: entry.threadId, threadName: entry.threadName, mtime: new Date(entry.mtime).getTime() });
    }
    anchors.sort((a, b) => a.mtime - b.mtime);

    let newMatches = 0;
    for (const [, entry] of Object.entries(index.sessions)) {
      if (entry.threadId) continue;
      const snapTime = new Date(entry.mtime).getTime();
      let bestDist = 4 * 60 * 60 * 1000, bestThread = null, bestName = null;
      for (const a of anchors) {
        const dist = Math.abs(snapTime - a.mtime);
        if (dist < bestDist) { bestDist = dist; bestThread = a.threadId; bestName = a.threadName; }
      }
      if (bestThread) { entry.threadId = bestThread; entry.threadName = bestName; entry.matchSource = 'snapshot_converge'; newMatches++; }
    }
    convergeRound++;
    if (newMatches === 0 || convergeRound > 10) break;
    log(`  Convergence round ${convergeRound}: +${newMatches} matches`);
  }

  // Backfill session_history
  let backfilled = 0;
  for (const [sid, entry] of Object.entries(index.sessions)) {
    if (!entry.threadId || historyBySessionId.has(sid)) continue;
    const sessionType = threads.find(t => t.id === entry.threadId)?.session_type || 'v2';
    const isCurrent = threadBySessionId.has(sid);
    try {
      insertHistory.run(crypto.randomUUID(), entry.threadId, sid, sessionType, entry.mtime, isCurrent ? null : entry.mtime, isCurrent ? null : 'resumed');
      historyBySessionId.set(sid, { session_id: sid, thread_id: entry.threadId });
      backfilled++;
    } catch {}
  }
  if (backfilled > 0) log(`  Backfilled ${backfilled} session_history records`);

  writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));

  const total = Object.keys(index.sessions).length;
  const matchedTotal = Object.values(index.sessions).filter(s => s.threadId).length;
  const unmatchedTotal = total - matchedTotal;
  const historyCount = db.prepare('SELECT COUNT(*) as c FROM session_history').get().c;

  log(`Indexed ${total} sessions`);
  log(`  Matched: ${matchedTotal} (${Math.round(matchedTotal / total * 100)}%)`);
  log(`  Unmatched: ${unmatchedTotal}`);
  log(`  session_history records: ${historyCount}`);

  db.close();
  log('Done.');
}

function writeEntry(index, sessionId, threadId, threadName, matchSource, meta, stat, isCurrent) {
  index.sessions[sessionId] = {
    threadId, threadName, matchSource,
    size: meta.size, lines: meta.lines,
    userMessages: meta.userMessages, assistantMessages: meta.assistantMessages,
    mtime: stat.mtime.toISOString(), isCurrent,
  };
}

function extractMeta(filePath, stat) {
  const meta = { size: stat.size, lines: 0, userMessages: 0, assistantMessages: 0, hasUserMessages: false, threadNameHint: null, mtime: stat.mtime.toISOString() };
  if (stat.size === 0) return meta;
  try {
    const content = readFileSync(filePath, 'utf-8');
    const threadMatch = content.match(/Thread:\s*\\"([^\\]+)\\"/);
    if (threadMatch) meta.threadNameHint = threadMatch[1];
    const lines = content.trim().split('\n');
    meta.lines = lines.length;
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj.type === 'user') { meta.userMessages++; meta.hasUserMessages = true; }
        if (obj.type === 'assistant') meta.assistantMessages++;
      } catch {}
    }
  } catch {}
  return meta;
}

run();
