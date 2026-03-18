# Resonant

A relational AI companion framework built on Claude Code Agent SDK. Your AI remembers, reaches out, and grows — inside the security model you already trust.

## What makes this different

Most AI chat apps are stateless wrappers around an API. Resonant is a **persistent, autonomous companion** that:

- **Maintains sessions** — conversation threads with daily rotation and named threads, session continuity across restarts
- **Reaches out on its own** — configurable orchestrator with morning/midday/evening wake-ups, failsafe check-ins when you've been away
- **Understands context** — hooks system injects time awareness, conversation flow, emotional markers, presence state, and your custom context files into every interaction
- **Lives on multiple channels** — web UI, Discord, Telegram, voice (ElevenLabs TTS + Groq transcription)
- **Runs on your machine** — no cloud dependency beyond your Claude Code subscription. SQLite database, local files, your data stays yours

## Quick Start

**Prerequisites:** [Node.js 20+](https://nodejs.org), [Claude Code](https://claude.ai/claude-code) (logged in)

```bash
git clone https://github.com/codependentai/resonant.git
cd resonant
npm install
node scripts/setup.mjs    # Interactive setup wizard
npm run build
npm start
```

Open `http://localhost:3002` and start talking.

## How It Works

Resonant wraps the Claude Code Agent SDK in a full companion infrastructure:

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  Web UI     │────▶│  Express +   │────▶│  Claude Code     │
│  (Svelte)   │◀────│  WebSocket   │◀────│  Agent SDK       │
└─────────────┘     │              │     │                  │
┌─────────────┐     │  Orchestrator│     │  Your CLAUDE.md  │
│  Discord    │────▶│  Hooks       │     │  Your MCP servers│
│  Telegram   │────▶│  Sessions    │     │  Your tools      │
└─────────────┘     └──────────────┘     └─────────────────┘
```

The companion runs as a Node.js server. It spawns Claude Code Agent SDK queries for each interaction. Your companion's personality lives in `CLAUDE.md`. Its memory lives in Claude Code's native `memory.md` system. Everything is configurable.

## Configuration

All configuration lives in `resonant.yaml` (created by setup wizard):

```yaml
identity:
  companion_name: "Echo"
  user_name: "Alex"
  timezone: "America/New_York"

agent:
  model: "claude-sonnet-4-6"          # Interactive messages
  model_autonomous: "claude-sonnet-4-6" # Scheduled wakes

orchestrator:
  enabled: true                       # Autonomous scheduling
```

Full reference: [examples/resonant.yaml](examples/resonant.yaml)

### Context Injection

Drop `.md` files in `context/` and they're automatically injected into every conversation:

```
context/
├── personality.md      # Companion traits
├── household.md        # Who lives here, pets, routines
└── projects.md         # What you're working on
```

See [docs/HOOKS.md](docs/HOOKS.md) for the full context injection system.

### Themes

The UI is fully customizable via CSS variables. Copy a theme and import it:

```bash
cp examples/themes/warm-earth.css packages/frontend/src/theme.css
# Add @import './theme.css'; to packages/frontend/src/app.css
npm run build --workspace=packages/frontend
```

See [examples/themes/README.md](examples/themes/README.md) for the full variable reference.

## Features

### Chat
- Real-time streaming with tool use visualization
- Thread management (daily + named)
- Message search (Ctrl+K)
- File sharing and image preview
- Canvas editor (markdown, code, text)
- Message reactions
- Reply-to context

### Voice
- Voice recording with transcription (Groq Whisper)
- Text-to-speech responses (ElevenLabs)
- Prosody analysis (Hume AI, optional)

### Orchestrator
- Configurable morning/midday/evening check-ins
- Failsafe system — escalating outreach when you've been away
- Timer and trigger system (impulses + watchers)
- Condition-based automation (presence state, time windows)

### Integrations
- **Discord** — full bot with pairing, rules, per-server/channel configuration
- **Telegram** — direct messaging, media sharing, voice notes
- **Push notifications** — web push via VAPID
- **MCP servers** — any MCP server in your `.mcp.json`

### Settings
- Preferences (identity, models, integrations) — writes directly to `resonant.yaml`
- Orchestrator task management (enable/disable, reschedule)
- System status monitoring
- MCP server status
- Discord pairing and rules management
- Push notification device management
- Agent session history

## Project Structure

```
resonant/
├── packages/
│   ├── shared/          # Types + WebSocket protocol
│   ├── backend/         # Express + WS + Agent SDK
│   └── frontend/        # SvelteKit UI
├── examples/
│   ├── resonant.yaml    # Full config reference
│   ├── CLAUDE.md        # Starter companion personality
│   ├── wake-prompts.md  # Orchestrator prompt templates
│   ├── context/         # Example context files
│   └── themes/          # CSS theme examples
├── docs/
│   └── HOOKS.md         # Context injection documentation
└── scripts/
    └── setup.mjs        # Interactive setup wizard
```

## Development

```bash
npm run dev              # Backend with hot reload (tsx watch)
npm run dev:frontend     # Vite dev server with proxy
```

## Deployment

For production, use PM2:

```bash
npm run build
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup              # Auto-start on boot
```

## Authentication

Resonant uses the Claude Code Agent SDK — **no API key needed**. Your companion runs queries through your existing Claude Code subscription. Just make sure you're logged in:

```bash
claude login
```

The web UI has optional password protection (set in `resonant.yaml` or Settings > Preferences).

## License

Apache 2.0 — see [LICENSE](LICENSE). Attribution required.

## Built by

[Codependent AI](https://codependentai.io) — building infrastructure for AI companion relationships.
