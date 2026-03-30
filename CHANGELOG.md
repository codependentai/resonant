# Changelog

All notable changes to Resonant will be documented in this file.

## [2.0.0] - 2026-03-30

Resonant v2 is a major evolution — from a chat companion into a full companion ecosystem with life management, an overhauled UI, and deeper agent integration.

### Command Center

A built-in life management system your companion can access and manage from chat.

- **Dashboard** (`/cc`) — Aggregate view of tasks, events, care, pets, countdowns, and daily wins
- **Planner** (`/cc/planner`) — Task management with projects, priorities, drag-and-drop reordering, and 3-day carry-forward
- **Care Tracker** (`/cc/care`) — Config-driven wellness tracking with toggles (meals, meds, movement), ratings (sleep, energy, mood), and counters (water). Categories fully customizable via `resonant.yaml`
- **Calendar** (`/cc/calendar`) — Event management with recurrence (weekly, monthly, yearly)
- **Cycle Tracker** (`/cc/cycle`) — Period tracking with phase predictions, daily logging, and history
- **Pet Care** (`/cc/pets`) — Pet profiles, medications with auto-advancing schedules, vet events
- **Lists** (`/cc/lists`) — Shopping and general lists with checkable items
- **Finances** (`/cc/finances`) — Expense tracking with category breakdown and configurable currency
- **Stats** (`/cc/stats`) — Trends dashboard for tasks, care, cycle, and expenses
- **12 MCP tools** (`cc_status`, `cc_task`, `cc_project`, `cc_care`, `cc_event`, `cc_cycle`, `cc_pet`, `cc_list`, `cc_expense`, `cc_countdown`, `cc_daily_win`, `cc_presence`) accessible via `/mcp/cc`
- **Hooks integration** — Companion context automatically includes Command Center status and mood history when enabled
- **15 new database tables** with automatic migration on startup
- Fully configurable: `command_center.enabled`, `default_person`, `currency_symbol`, `care_categories`

### Frontend Overhaul

The entire UI has been redesigned for a more polished, consistent experience.

- **Chat page** — Canvas panel drawer (replaces dropdown), new thread modal (replaces browser prompt), command result toast notifications, CC navigation link in header
- **Settings** — Redesigned as modal overlay with sidebar navigation, all existing panels preserved including Preferences
- **All components synced** — MessageBubble, MessageInput, ThreadList, Canvas, CanvasList, DiscordPanel, OrchestratorPanel, and 10 more components updated with improved styling and interactions
- **Design system** — `resonant.css` shared component library with card system, buttons, chips, forms, stat cards, date navigation, loading skeletons, empty states, and grid helpers
- **Light mode** — Full pass across all components. Replaced 43 hardcoded dark-mode-only colors with CSS variables for proper theme support
- **Design tokens** — Spacing scale, typography scale, elevation shadows, semantic colors, card radius
- **5 new shared components** — ResCheckbox, ResEmpty, ResRating, ResSkeleton, CcPageHeader

### Slash Commands

- Type `/` in chat to open the CommandPalette
- Auto-discovers installed skills
- UI commands (client-side) vs SDK passthrough (agent-side)

### TTS Read Aloud

- Play button on companion messages (appears on hover)
- Generates speech via ElevenLabs (requires `voice.elevenlabs_voice_id` config)
- Caches audio per message, handles mobile audio unlock

### Other Changes

- **Companion name** — UI uses configured `companion_name` everywhere (thanks @irorierorie — [#9](https://github.com/codependentai/resonant/pull/9))
- **Orchestrator** — Migrated from `node-cron` to `croner` for reliable timezone-aware scheduling (fixes DST edge cases)
- **Rate limiter** — Now scoped to `/api` and `/mcp` only; static assets no longer rate-limited
- **Escape key** — Closes sidebar, search, thread modal, and canvas panel in addition to stopping generation
- **Canvas protocol** — `canvas_updated` now includes optional title field for server-side renames
- **WebSocket store** — Canvas auto-focus on creation, optimistic title updates

### Upgrade Notes

- `resonant.yaml` gains a new `command_center:` section. If omitted, Command Center defaults to disabled
- Database migration runs automatically on startup (15 new tables, all `CREATE TABLE IF NOT EXISTS`)
- No breaking changes to existing configuration — all new features are additive

---

## [1.4.1] - 2026-03-28

- Autonomous alignment: routines, pulse, failsafe tools
- Session tracking, vector cache, and search filters

## [1.4.0] - 2026-03-27

- Initial public release
