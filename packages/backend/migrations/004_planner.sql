CREATE TABLE IF NOT EXISTS planner_tasks (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  person TEXT NOT NULL DEFAULT 'user',
  title TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tasks_date_person ON planner_tasks(date, person);

CREATE TABLE IF NOT EXISTS planner_schedule (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  title TEXT NOT NULL,
  note TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_schedule_date ON planner_schedule(date);

CREATE TABLE IF NOT EXISTS planner_projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  person TEXT NOT NULL DEFAULT 'both',
  status TEXT NOT NULL DEFAULT 'active',
  note TEXT,
  due_date TEXT DEFAULT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
