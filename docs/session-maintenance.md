# Session Maintenance

## The Problem: SDK Session Fragmentation

The Claude Agent SDK creates a new `.jsonl` session file every time `query()` is called, even when resuming an existing session. The conversation context is preserved (the SDK loads history from the previous session), but each call generates a new session ID and a new file on disk.

This means:

- A thread with 50 message exchanges produces ~50 session files
- At typical usage (100-200 messages/day), this grows to thousands of files within weeks
- Files accumulate in `~/.claude/projects/<encoded-cwd>/` (encoded from your `AGENT_CWD`)
- The files aren't garbage — they're valid conversation history — but they're not indexed

This is a known SDK behavior ([anthropics/claude-code#8069](https://github.com/anthropics/claude-code/issues/8069)), not a bug in Resonant.

## What Resonant Does About It

### Automatic session tracking (v1.4.0+)

Every time the SDK returns a new session ID, Resonant:

1. Records the transition in the `session_history` table (old session → new session)
2. Updates the thread's `current_session_id` to the new value
3. Stores the end reason (`resumed`) on the old session record

This builds a chain: session A → B → C per thread, so you always know which files belong to which conversation.

### Session indexer script

`scripts/index-sessions.mjs` scans all SDK session files and:

- Matches each file to a thread (by extracting the thread name from the orientation context)
- Links snapshot-only files (from file checkpointing) to the nearest session by timestamp
- Backfills `session_history` for any untracked sessions
- Writes a `sessions-index.json` for fast lookups

## Setup

### 1. Run the indexer (one-time backfill)

After updating to v1.4.0+, run the indexer to reconstruct history for existing sessions:

```bash
# From your Resonant root directory
# Set AGENT_CWD to your companion's working directory
# Set DB_PATH to your database location

AGENT_CWD=/path/to/companion DB_PATH=./data/resonant.db node scripts/index-sessions.mjs
```

On first run this will:
- Scan all `.jsonl` files in `~/.claude/projects/<encoded-cwd>/`
- Match ~97% of files to their threads
- Backfill the `session_history` table
- Create `sessions-index.json`

This typically takes 5-10 seconds for a few thousand session files.

### 2. Set up daily indexing (recommended)

New orphan session files are created every time your companion processes a message. Run the indexer daily to keep the index current.

**Option A: PM2 cron**

Add to your `ecosystem.config.cjs`:

```js
{
  name: 'session-indexer',
  script: 'scripts/index-sessions.mjs',
  cwd: '/path/to/resonant',
  cron_restart: '0 5 * * *', // daily at 5 AM
  autorestart: false,
  env: {
    DB_PATH: './data/resonant.db',
    AGENT_CWD: '/path/to/companion',
  },
}
```

Then: `pm2 start ecosystem.config.cjs --only session-indexer && pm2 save`

**Option B: System cron**

```bash
# crontab -e
0 5 * * * cd /path/to/resonant && AGENT_CWD=/path/to/companion DB_PATH=./data/resonant.db node scripts/index-sessions.mjs >> logs/session-indexer.log 2>&1
```

**Option C: Manual**

Just run `node scripts/index-sessions.mjs` whenever you want to update the index. Subsequent runs are fast (~1 second) because unchanged files are cached.

### 3. Fix broken thread references (if needed)

If you have threads that point to session files that no longer exist (common for early threads created before session tracking was added), you can null them out:

```bash
node -e "
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const homedir = require('os').homedir();

const DB_PATH = process.env.DB_PATH || './data/resonant.db';
const AGENT_CWD = process.env.AGENT_CWD || process.cwd();

// Derive sessions directory
const encoded = AGENT_CWD.replace(/\//g, '\\\\').replace(/[^a-zA-Z0-9]/g, '-');
const sessionsDir = path.join(homedir, '.claude', 'projects', encoded);

const db = new Database(DB_PATH);
const threads = db.prepare('SELECT id, name, current_session_id FROM threads WHERE current_session_id IS NOT NULL').all();

let fixed = 0;
for (const t of threads) {
  const sessionFile = path.join(sessionsDir, t.current_session_id + '.jsonl');
  if (!fs.existsSync(sessionFile)) {
    db.prepare('UPDATE threads SET current_session_id = NULL WHERE id = ?').run(t.id);
    console.log('Fixed:', t.name);
    fixed++;
  }
}
console.log('Fixed', fixed, 'broken references');
db.close();
"
```

These threads will start a fresh session on the next message.

## How It Works Internally

### Session file contents

Each `.jsonl` file contains:
- `queue-operation` entries (session metadata)
- `file-history-snapshot` entries (from file checkpointing)
- `user` and `assistant` message entries (the actual conversation)

Files with user messages (~2% of total) are matched by the `Thread: "name"` in the orientation context block. The remaining ~98% are snapshot-only files matched by timestamp proximity to known sessions.

### The convergence algorithm

The indexer uses iterative anchoring:
1. First pass: match files with user messages (reliable thread name extraction)
2. Second pass: link snapshot files to the nearest matched session within 4 hours
3. Convergence: each matched file becomes a new anchor, allowing more snapshots to match
4. Typically converges in 3-4 rounds, reaching ~97% match rate

### Database schema

```sql
CREATE TABLE session_history (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  session_id TEXT NOT NULL UNIQUE,
  session_type TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  end_reason TEXT, -- 'resumed', 'compaction', 'error', etc.
  tokens_used INTEGER,
  cost_usd REAL,
  peak_memory_mb INTEGER,
  FOREIGN KEY (thread_id) REFERENCES threads(id)
);
```

### Disk usage

Session files are typically small:
- Snapshot-only files: 200 bytes – 10 KB
- Short conversations: 10-100 KB
- Full day sessions: 1-7 MB

At 3,000 session files, total disk usage is ~250 MB. The indexer doesn't delete files — it only indexes them.
