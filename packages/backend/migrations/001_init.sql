-- Threads
CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('daily', 'named')),
  created_at TEXT NOT NULL,
  archived_at TEXT,
  current_session_id TEXT,
  session_type TEXT DEFAULT 'v2' CHECK(session_type IN ('v1', 'v2')),
  needs_reground INTEGER DEFAULT 0,
  last_activity_at TEXT,
  unread_count INTEGER DEFAULT 0,
  pinned_at TEXT DEFAULT NULL
);

-- Messages
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('companion', 'user', 'system')),
  content TEXT NOT NULL,
  content_type TEXT DEFAULT 'text' CHECK(content_type IN ('text', 'image', 'audio', 'file')),
  platform TEXT DEFAULT 'web',
  metadata TEXT,
  reply_to_id TEXT,
  edited_at TEXT,
  deleted_at TEXT,
  original_content TEXT,
  created_at TEXT NOT NULL,
  delivered_at TEXT,
  read_at TEXT,
  FOREIGN KEY (thread_id) REFERENCES threads(id),
  FOREIGN KEY (reply_to_id) REFERENCES messages(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_thread_seq ON messages(thread_id, sequence);
CREATE INDEX IF NOT EXISTS idx_messages_thread_created ON messages(thread_id, created_at);

-- Outbound queue
CREATE TABLE IF NOT EXISTS outbound_queue (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'delivered', 'failed')),
  push_sent INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES threads(id),
  FOREIGN KEY (message_id) REFERENCES messages(id)
);

-- Push subscriptions
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('web_push', 'apns')),
  endpoint TEXT,
  keys_p256dh TEXT,
  keys_auth TEXT,
  device_token TEXT,
  device_name TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

-- Session history
CREATE TABLE IF NOT EXISTS session_history (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  session_id TEXT NOT NULL UNIQUE,
  session_type TEXT NOT NULL CHECK(session_type IN ('v1', 'v2')),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  end_reason TEXT CHECK(end_reason IN ('compaction', 'reaper', 'daily_rotation', 'error', 'manual', 'resumed')),
  tokens_used INTEGER,
  cost_usd REAL,
  peak_memory_mb INTEGER,
  FOREIGN KEY (thread_id) REFERENCES threads(id)
);

-- Audit log
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  tool_input TEXT,
  tool_output TEXT,
  triggering_message_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_log(session_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

-- Web sessions (auth)
CREATE TABLE IF NOT EXISTS web_sessions (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- Config
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Canvases
CREATE TABLE IF NOT EXISTS canvases (
  id TEXT PRIMARY KEY,
  thread_id TEXT,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  content_type TEXT NOT NULL DEFAULT 'markdown' CHECK(content_type IN ('markdown', 'code', 'text', 'html')),
  language TEXT,
  created_by TEXT NOT NULL DEFAULT 'user' CHECK(created_by IN ('companion', 'user')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES threads(id)
);

CREATE INDEX IF NOT EXISTS idx_canvases_thread ON canvases(thread_id);
CREATE INDEX IF NOT EXISTS idx_canvases_updated ON canvases(updated_at);

-- Timers
CREATE TABLE IF NOT EXISTS timers (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  context TEXT,
  fire_at TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  prompt TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  fired_at TEXT,
  FOREIGN KEY (thread_id) REFERENCES threads(id)
);

-- Triggers (impulse queue + event watchers)
CREATE TABLE IF NOT EXISTS triggers (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  conditions TEXT NOT NULL,
  prompt TEXT,
  thread_id TEXT,
  cooldown_minutes INTEGER DEFAULT 120,
  status TEXT NOT NULL DEFAULT 'pending',
  last_fired_at TEXT,
  fire_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  fired_at TEXT,
  FOREIGN KEY (thread_id) REFERENCES threads(id)
);
