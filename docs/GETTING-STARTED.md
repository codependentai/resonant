# Getting Started with Resonant

This guide walks you through setting up Resonant from scratch. Resonant is self-hosted: the app, database, identity files, and configuration live on your machine.

## What You Need

1. A computer running Windows, macOS, or Linux
2. An internet connection
3. Node.js 20-24 LTS
4. At least one supported runtime login

Runtime options in v2.2.0:

- **Claude Code** is the default full-featured runtime. Log in with `claude login`.
- **OpenAI Codex** is available experimentally through your local Codex authentication and can be selected in Settings.
- **OpenRouter** settings and API-key storage are present for BYOK model routing, but OpenRouter chat execution is not released yet.

## Step 1: Install Node.js

**Windows**

1. Go to [nodejs.org](https://nodejs.org)
2. Download the LTS installer
3. Run it, then restart your terminal

**macOS**

```bash
brew install node
```

Or download the installer from [nodejs.org](https://nodejs.org).

**Linux (Ubuntu/Debian)**

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

Verify:

```bash
node --version    # v20, v22, v23, or v24
npm --version
```

Node 25+ is not supported.

## Step 2: Install and Log In to a Runtime

For the default Claude Code runtime:

```bash
npm install -g @anthropic-ai/claude-code
claude login
```

For OpenAI Codex, install and authenticate Codex locally, then select `openai-codex` in Settings after Resonant is running.

## Step 3: Download Resonant

```bash
git clone https://github.com/codependentai/resonant.git
cd resonant
```

If you do not have git, download the ZIP from GitHub and extract it.

## Step 4: Install Dependencies

```bash
npm install
```

## Step 5: Run the Setup Wizard

```bash
node scripts/setup.mjs
```

The wizard asks for:

1. Companion name
2. Your name
3. Optional UI password
4. Timezone

It creates `resonant.yaml`, `.env`, `.mcp.json`, wake prompts, PM2 config, and a provider-neutral identity scaffold under `identity/`.

## Step 6: Customize Identity

Edit `identity/companion.md` and `identity/companion.profile.yaml`. These are the canonical identity files for new installs.

Existing installs can still use `CLAUDE.md`. Resonant treats `CLAUDE.md` as a legacy fallback, useful for Claude Code compatibility, rather than the conceptual source of truth.

## Step 7: Build and Start

```bash
npm run build
npm start
```

Open:

```text
http://localhost:3002
```

## What the Files Do

```text
resonant/
├── identity/
│   ├── companion.profile.yaml   # Structured identity
│   ├── companion.md             # Narrative identity
│   └── provider-overrides/      # Optional provider-specific notes
├── CLAUDE.md                    # Legacy Claude Code fallback
├── resonant.yaml                # Configuration
├── .env                         # Secrets and environment values
├── .mcp.json                    # MCP server connections
├── prompts/wake.md              # Autonomous wake prompts
├── data/resonant.db             # SQLite database
└── ecosystem.config.cjs         # PM2 config
```

Customize `identity/*`, `prompts/wake.md`, and `resonant.yaml`. Do not hand-edit `data/resonant.db`.

## Settings You Should Know

The Settings page surfaces the important runtime and integration knobs:

- Identity files and editable companion narrative
- Interactive and autonomous runtime/model selection
- Scribe digest provider, model, interval, message threshold, and digest path
- Discord bot configuration
- Telegram gateway configuration
- Push notification VAPID status and contact URI
- Orchestrator routines, pulse, failsafe, timers, impulses, and watchers
- Command Center configuration
- Active agent sessions where the selected runtime supports native session listing

OpenRouter can be configured in Settings, including base URL, default model, and write-only API key handling. It is not yet an active chat runtime in v2.2.0.

## Accessing from Other Devices

For a phone on the same WiFi, you can bind Resonant to your local network:

```yaml
server:
  host: "0.0.0.0"
auth:
  password: "set-a-strong-password"
```

Then restart and open `http://YOUR-COMPUTER-IP:3002`.

For access away from home, read [REMOTE-ACCESS.md](REMOTE-ACCESS.md). The recommended private companion setup is Tailscale first. Cloudflare Tunnel is optional when you need a public HTTPS domain, PWA install, or push-notification-friendly HTTPS endpoint; use it with Cloudflare Access and Resonant's own password.

## Keeping It Running

Use PM2 to keep Resonant alive after you close the terminal:

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Useful commands:

```bash
pm2 status
pm2 logs resonant
pm2 restart resonant
pm2 stop resonant
```

## Memory and Context

Resonant maintains continuity through local sessions, semantic search, scribe digests, hook-injected orientation context, and whatever memory tools your runtime can use. Claude Code can also use its native memory system. The provider-neutral identity layer keeps the same companion coherent across runtimes where capabilities allow.

## Command Center

Resonant includes a built-in life management system at `/cc`. Enable it in Settings or `resonant.yaml`:

```yaml
command_center:
  enabled: true
  default_person: "user"
  currency_symbol: "$"
```

Command Center includes planner, care tracker, calendar, cycle tracker, pet care, lists, finances, stats, scratchpad, and companion-accessible MCP tools.

## Troubleshooting

**`npm install` fails with a `better-sqlite3` build error on Windows**

```bash
npm install --ignore-scripts
npm install -g node-gyp
cd node_modules/better-sqlite3
node-gyp rebuild
cd ../..
```

**Claude Code says not logged in**

```bash
claude login
claude -p "hello"
```

**Address already in use**

Change `server.port` in `resonant.yaml`, then restart.

**The companion does not respond**

Check the terminal or PM2 logs, confirm your runtime login, and confirm your internet connection.

**Forgot your password**

Clear `auth.password` in `resonant.yaml`, then restart.

## What's Next

- Connect Discord or Telegram from Settings.
- Configure Push/VAPID for web push notifications.
- Tune Scribe digests from Settings.
- Type `/` in chat to browse slash commands.
- Customize themes with `examples/themes/README.md`.
- Read [TOOLS.md](TOOLS.md), [HOOKS.md](HOOKS.md), and [MEMORY_ARCHITECTURE.md](MEMORY_ARCHITECTURE.md) for deeper behavior.
