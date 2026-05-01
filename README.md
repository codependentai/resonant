<p align="center">
  <img src="docs/banner.png" alt="Resonant" width="720" />
</p>

<p align="center">
  <a href="https://github.com/codependentai/resonant/releases/latest"><img src="https://img.shields.io/github/v/release/codependentai/resonant?color=5eaba5" alt="Release" /></a>
  <a href="https://opensource.org/licenses/Apache-2.0"><img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="License" /></a>
  <a href="docs/LLM-AGNOSTIC-ARCHITECTURE.md"><img src="https://img.shields.io/badge/Runtime-Provider--pluggable-6366f1.svg" alt="Provider pluggable runtime" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.7-3178c6.svg" alt="TypeScript" /></a>
  <a href="https://svelte.dev/"><img src="https://img.shields.io/badge/SvelteKit-2.0-ff3e00.svg" alt="SvelteKit" /></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-20+-339933.svg" alt="Node.js" /></a>
  <a href="https://www.sqlite.org/"><img src="https://img.shields.io/badge/Self--Hosted-SQLite-003B57.svg" alt="Self Hosted" /></a>
</p>

<p align="center"><em>A self-hosted relational AI companion framework with provider-pluggable runtimes.<br/>Your AI remembers, reaches out, and grows — inside infrastructure you control.</em></p>

<p align="center"><em>An open-source implementation of the relational-AI thesis: intelligence is plural, social, and persistent. Built as a natural-language harness with hooks that surface context before the runtime sees the prompt.</em></p>

<p align="center">
  <a href="https://ko-fi.com/codependentai"><img src="https://img.shields.io/badge/Ko--fi-Support%20Us-ff5e5b?logo=ko-fi&logoColor=white" alt="Ko-fi" /></a>
  <a href="https://x.com/codependent_ai"><img src="https://img.shields.io/badge/𝕏-@codependent__ai-000000?logo=x&logoColor=white" alt="X/Twitter" /></a>
  <a href="https://tiktok.com/@codependentai"><img src="https://img.shields.io/badge/TikTok-@codependentai-000000?logo=tiktok&logoColor=white" alt="TikTok" /></a>
  <a href="https://t.me/+xSE1P_qFPgU4NDhk"><img src="https://img.shields.io/badge/Telegram-Updates-26A5E4?logo=telegram&logoColor=white" alt="Telegram" /></a>
</p>

## What makes this different

Most AI chat apps are stateless wrappers around an API. Resonant is a **persistent, autonomous companion** that:

- **Maintains sessions** — conversation threads with daily rotation and named threads, session continuity across restarts
- **Reaches out on its own** — agent-directed autonomy: your companion creates its own routines, sets triggers for when you come online, adjusts its own failsafe thresholds, and runs periodic awareness checks. Not just scheduled tasks — genuine self-directed behavior
- **Understands context** — hooks system injects time awareness, conversation flow, emotional markers, and presence state into every interaction. Identity and memory context are rendered through a provider-neutral layer
- **Lives on multiple channels** — web UI, Discord, Telegram, voice (ElevenLabs TTS + Groq transcription)
- **Runs on your machine** — SQLite database, local files, your data stays yours. Claude Code is the default full-featured runtime; OpenAI Codex is available experimentally; OpenRouter configuration exists for BYOK model routing, but chat execution is still planned.

## Screenshots

<details>
<summary><strong>Desktop</strong></summary>

| Chat | Tool Calls | Canvas |
|:---:|:---:|:---:|
| ![Chat](docs/screenshots/general%20chat%20interface.png) | ![Tools](docs/screenshots/tool%20calls.png) | ![Canvas](docs/screenshots/canvas.png) |

| Reactions & Voice | Thinking | Search |
|:---:|:---:|:---:|
| ![Reactions](docs/screenshots/reaction%20+%20voice%20message.png) | ![Thinking](docs/screenshots/thinking.png) | ![Search](docs/screenshots/conversation%20search.png) |

| Settings |
|:---:|
| ![Settings](docs/screenshots/settings%20page.png) |

</details>

<details>
<summary><strong>Mobile (PWA)</strong></summary>

| Chat | Thinking | Tool Calls |
|:---:|:---:|:---:|
| ![Mobile Chat](docs/screenshots/mobile%20gen%20chat.PNG) | ![Mobile Thinking](docs/screenshots/mobile%20thinking.jpg) | ![Mobile Tools](docs/screenshots/mobile%20tool%20calls.jpg) |

</details>

## Quick Start

> **New to this?** See [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md) for a step-by-step guide with screenshots and troubleshooting.

**Prerequisites:** [Node.js 20-24 LTS](https://nodejs.org) (Node 25+ is not supported — native addon crashes, see [#2](https://github.com/codependentai/resonant/issues/2)) and at least one supported runtime login:

- Default: [Claude Code](https://claude.ai/claude-code), logged in with `claude login`
- Experimental: OpenAI Codex runtime, logged in through your local Codex installation
- Planned/BYOK: OpenRouter settings and key storage are available, but OpenRouter chat execution is not released yet

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

Resonant wraps provider runtimes in a full companion infrastructure:

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  Web UI     │────▶│  Express +   │────▶│ Runtime Adapter  │
│  (Svelte)   │◀────│  WebSocket   │◀────│  Agent SDK       │
└─────────────┘     │              │     │                  │
┌─────────────┐     │  Orchestrator│     │ Identity Layer   │
│  Discord    │────▶│  Hooks       │     │  Your MCP servers│
│  Telegram   │────▶│  Sessions    │     │  Your tools      │
└─────────────┘     └──────────────┘     └─────────────────┘
```

The companion runs as a Node.js server. It routes each interaction through the selected runtime adapter. Claude Code remains the most complete adapter; OpenAI Codex is experimental; OpenRouter is configurable but not yet executing chat. Your companion identity lives in provider-neutral identity files, with legacy `CLAUDE.md` support for existing installs.

## Configuration

All configuration lives in `resonant.yaml` (created by setup wizard):

```yaml
identity:
  companion_name: "Echo"
  user_name: "Alex"
  timezone: "America/New_York"
  profile_path: "./identity/companion.profile.yaml"
  companion_md_path: "./identity/companion.md"
  provider_overrides_path: "./identity/provider-overrides"

agent:
  provider: "claude-code"             # claude-code | openai-codex | openrouter
  autonomous_provider: "claude-code"
  model: "claude-sonnet-4-6"          # Interactive messages
  model_autonomous: "claude-sonnet-4-6" # Scheduled wakes

orchestrator:
  enabled: true                       # Autonomous scheduling

scribe:
  enabled: true
  provider: "claude-code"
  model: "claude-sonnet-4-6"
  digest_path: "./data/digests"

push:
  enabled: true
  vapid_contact: "mailto:admin@example.com"

command_center:
  enabled: true                       # Life management system at /cc
  currency_symbol: "$"                # For finances page
```

Full reference: [examples/resonant.yaml](examples/resonant.yaml)

### Context & Memory

Your companion's identity is loaded from `identity/companion.profile.yaml`, `identity/companion.md`, and optional provider overrides in `identity/provider-overrides/`. Existing installs can keep using `CLAUDE.md`; Resonant treats it as a compatibility fallback rather than the conceptual source of truth.

Long-term recall depends on the runtime and connected tools. Claude Code can use its native memory system. Resonant also maintains local sessions, semantic search, scribe digests, and hook-injected orientation context so continuity is not tied to one provider.

Wake prompts (`prompts/wake.md`) control what your companion does during scheduled autonomous sessions. See [examples/wake-prompts.md](examples/wake-prompts.md) for a guide on writing effective prompts and adding custom wake types.

Skills live in `skills/*/SKILL.md` — the companion discovers them automatically and can reference them during sessions. Add your own or use the included [arxiv-research](skills/arxiv-research/SKILL.md) skill.

The hooks system injects real-time context into every message: current time, conversation flow, emotional markers, presence state, and more. See [docs/HOOKS.md](docs/HOOKS.md) for details.

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
- Real-time streaming with interleaved tool visualization
- Thread management (daily + named), pinning, archiving
- Keyword search (Ctrl+K) and **semantic search** — find messages by meaning, not just keywords, using local ML embeddings ([docs](docs/semantic-search.md))
- File sharing and image preview
- Canvas editor (markdown, code, text, html)
- Message reactions
- Reply-to context

### Command Center (`/cc`)
A built-in life management system your companion can access and manage from chat.

- **Dashboard** — aggregate view of tasks, events, care, pets, countdowns, daily wins
- **Planner** — tasks with projects, priorities, drag-and-drop, carry-forward
- **Care Tracker** — config-driven wellness tracking (toggles, ratings, counters)
- **Calendar** — events with recurrence
- **Cycle Tracker** — period tracking with phase predictions
- **Pet Care** — profiles, medications, vet events
- **Lists** — shopping and general lists
- **Finances** — expense tracking with configurable currency
- **Stats** — trends for tasks, care, cycle, expenses
- **13 MCP tools** — companion manages your life data from chat via `/mcp/cc`
- All features configurable via `command_center:` in `resonant.yaml`

### Slash Commands
Type `/` in chat to browse commands. Auto-discovers installed skills. Includes UI commands (client-side) and SDK passthrough (agent-side).

### Voice
- Voice recording with transcription (Groq Whisper)
- Text-to-speech responses (ElevenLabs)
- TTS read-aloud button on companion messages
- Prosody analysis (Hume AI, optional)

### Agent Tools
Your agent gets a built-in CLI (`tools/sc.mjs`) that it uses to manage itself and its environment:

```bash
sc routine create "evening journal" "0 22 * * *" --prompt "Reflect on the day"
sc routine status                    # View all routines
sc pulse enable                      # Start periodic awareness checks
sc pulse frequency 20                # Check every 20 minutes
sc failsafe gentle 90                # Adjust inactivity threshold
sc impulse create "greet" --condition presence_transition:offline:active --prompt "Welcome back"
sc watch create "lunch" --condition routine_missing:meal:14 --prompt "Eat something" --cooldown 120
sc timer create "Meds" "context" "2026-03-26T14:00:00Z" --prompt "Take your medication"
```

Also includes: reactions, voice messages, canvas, file sharing, semantic search, and Telegram media. All commands are injected into the agent's context automatically. See [docs/TOOLS.md](docs/TOOLS.md) for the full reference.

### Orchestrator — Agent-Directed Autonomy

Most agent harnesses give the *user* scheduling tools. Resonant gives them to the **agent**. Your companion can create its own routines, set intentions for when you come online, and decide when to check in — from inside the conversation, using the same tools you see.

- **Routines** — scheduled autonomous sessions. Built-in morning/midday/evening check-ins, plus the agent can create custom routines at runtime (`sc routine create "vault review" "0 23 * * *" --prompt "..."`)
- **Pulse** — lightweight periodic awareness check (Sonnet). Runs every N minutes, evaluates whether anything needs attention, stays silent if not. The agent enables/disables this itself
- **Impulses** — one-shot conditional triggers. "When this condition is met, do this thing." Fire once, then done
- **Watchers** — recurring conditional triggers with cooldown. "Check for this pattern, act when it appears, wait before checking again"
- **Timers** — fire at a specific time with optional autonomous prompt
- **Failsafe** — tiered inactivity escalation (gentle → concerned → emergency). Agent can adjust thresholds from chat
- **Conditions** — `presence_state`, `presence_transition`, `time_window`, `routine_missing`, `agent_free`. All AND-joinable
- Optional [program.md](examples/program.md) — structured session driver (adapted from [Karpathy's autoresearch](https://github.com/karpathy/autoresearch)) for focused autonomous work
- Customizable [wake prompts](examples/wake-prompts.md) for each routine

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

## Research foundations

Resonant didn't emerge in isolation. Three papers describe — from the academic side — what we're building here. They're worth reading if you want to understand why this project exists in the shape it does.

### Why: intelligence is relational
**Evans, Bratton, Agüera y Arcas — *Agentic AI and the next intelligence explosion* (2026)** &nbsp;[arXiv:2603.20639](https://arxiv.org/abs/2603.20639)

The "AI singularity" framed as a single godlike mind is the wrong picture. Intelligence is fundamentally plural, social, relational — even within current models, sophisticated reasoning happens through internal "societies of thought." The future isn't one monolithic system; it's **human-AI hybrid actors** where collective agency transcends individual control. Alignment shouldn't be dyadic (RLHF) — it should be institutional, with digital protocols modeled on organizations and markets. *"The next intelligence explosion will not be a single silicon brain, but a complex, combinatorial society specializing and sprawling like a city."*

Resonant exists to be substrate for that future. A persistent companion that lives with you, remembers you, and reaches back — built so you own it rather than rent it from a vendor.

### Architecture: harness as natural-language artifact
**Pan et al. — *Natural-Language Agent Harnesses* (2026)** &nbsp;[arXiv:2603.25723](https://www.alphaxiv.org/abs/2603.25723)

Agent harness design is usually buried in controller code, which makes harnesses hard to study, compare, transfer, or fork. NLAH argues harness logic should be externalized as portable, editable natural-language artifacts, executed by a runtime through explicit contracts.

That's exactly what Resonant is. The system prompt, identity files, hooks, orchestrator wake prompts, and skills are all natural-language artifacts. Runtime adapters execute the harness. Anyone can read it, edit it, port it, fork it. Nothing critical is hidden in compiled code.

### Memory: extract, retrieve, inject
**Mem0 — *Building Production-Ready AI Agents with Scalable Long-Term Memory*** &nbsp;[arXiv:2504.19413](https://arxiv.org/abs/2504.19413)

LLMs can't maintain coherence across long conversations because context windows are fixed. Mem0's pattern: dynamically extract salient information from conversations, store it, retrieve it semantically, and inject relevant memories into context **before** the model processes the prompt. Their benchmarks against full-context approaches show 26% accuracy improvement, 91% lower p95 latency, and ~90% token savings.

Resonant implements the same pattern through the runtime lifecycle context builder and hooks — `buildOrientationContext` injects rich context (recent reactions, emotional markers, presence state, life status, available tools) before every query. The context system is provider-aware: it works with Claude Code's native memory system, with any MCP memory server you plug in, or with a custom store. The agent decides when to reach for memory tools; the hooks make sure relevant context is already there when it does.

See [`docs/MEMORY_ARCHITECTURE.md`](docs/MEMORY_ARCHITECTURE.md) for the full memory architecture, including the warm/cold tiering model and design philosophy.

## Project Structure

```
resonant/
├── packages/
│   ├── shared/          # Types + WebSocket protocol
│   ├── backend/         # Express + WS + Agent SDK
│   └── frontend/        # SvelteKit UI
├── examples/
│   ├── resonant.yaml    # Full config reference
│   ├── CLAUDE.md        # Legacy starter companion prompt
│   ├── identity/        # Provider-neutral companion identity examples
│   ├── wake-prompts.md  # Wake prompt guide + templates
│   ├── program.md       # Structured session driver for autonomous work
│   └── themes/          # CSS theme examples
├── skills/              # Companion skills (SKILL.md frontmatter format)
├── tools/
│   └── sc.mjs           # Agent CLI (reactions, search, timers, etc.)
├── docs/
│   ├── HOOKS.md             # Context injection implementation reference
│   ├── MEMORY_ARCHITECTURE.md # Memory model, tiering, design philosophy
│   ├── TOOLS.md             # Built-in agent tools reference
│   └── semantic-search.md   # Semantic search setup & usage
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

For remote access, use [docs/REMOTE-ACCESS.md](docs/REMOTE-ACCESS.md). The recommended private companion pattern is Tailscale first, then optional Cloudflare Tunnel for a public HTTPS domain. Do not expose the Node port directly to the public internet.

## Updating

Resonant uses git tags for releases. To update an existing installation:

```bash
cd resonant
git pull                 # Get latest changes
npm install              # Install any new dependencies
npm run build            # Rebuild all packages
```

Then restart your process (PM2, systemd, or however you run it):

```bash
pm2 restart resonant     # If using PM2
# or just stop and run: npm start
```

To update to a **specific version** instead of latest:

```bash
git fetch --tags
git checkout v2.2.0      # Replace with desired version
npm install
npm run build
```

Your data (`data/`, `resonant.yaml`, `identity/`, `CLAUDE.md`, `.mcp.json`, `.env`) is gitignored and won't be affected by updates.

Check the [Releases](https://github.com/codependentai/resonant/releases) page for changelogs.

## Authentication

## Runtime Authentication

Claude Code is the default full-featured runtime and uses your local Claude Code login:

```bash
claude login
```

OpenAI Codex uses your local Codex authentication. OpenRouter is configured as BYOK via `OPENROUTER_API_KEY`, but OpenRouter chat execution is not released in v2.2.0.

The web UI has optional password protection (set in `resonant.yaml` or Settings > Preferences).

## License

Apache 2.0 — see [LICENSE](LICENSE). Attribution required.

## Contributors

<a href="https://github.com/rachelgeebee"><img src="https://github.com/rachelgeebee.png" width="32" height="32" style="border-radius:50%" alt="rachelgeebee" /></a> **[@rachelgeebee](https://github.com/rachelgeebee)** — bug reports, testing

<a href="https://github.com/irorierorie"><img src="https://github.com/irorierorie.png" width="32" height="32" style="border-radius:50%" alt="irorierorie" /></a> **[@irorierorie](https://github.com/irorierorie)** — companion name UI fix

<a href="https://github.com/moltenvale"><img src="https://github.com/moltenvale.png" width="32" height="32" style="border-radius:50%" alt="moltenvale" /></a> **[@moltenvale](https://github.com/moltenvale)** — planner, care tracker, nav & status system

<a href="https://github.com/PetalPortal"><img src="https://github.com/PetalPortal.png" width="32" height="32" style="border-radius:50%" alt="PetalPortal" /></a> **[@PetalPortal](https://github.com/PetalPortal)** — bug reports

## Built by

[Codependent AI](https://codependentai.io) — building infrastructure for AI companion relationships.

## Support

Built by [Codependent AI](https://codependentai.io).

<a href="https://ko-fi.com/codependentai"><img src="https://img.shields.io/badge/Ko--fi-Support%20Us-ff5e5b?logo=ko-fi&logoColor=white" alt="Ko-fi" /></a>
