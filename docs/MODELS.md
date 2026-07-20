# Models & the Claude runtime — upgrading and adding new models

How Resonant bundles its Anthropic runtime, how to upgrade it when a new Claude
model ships, and how to make that model selectable in the app.

> **Not the same as [`UPGRADING.md`](UPGRADING.md).** That guide moves your data
> from one Resonant *version* to the next. This page is about the *Claude
> runtime and the model list* — bumping the SDK when Anthropic ships a new model,
> and surfacing that model in the picker. You don't need a version upgrade to do
> any of this.

---

## How the Claude runtime is bundled

Resonant's only Anthropic dependency is the **Claude Agent SDK**. There is **no
separate Claude Code install** — the SDK vendors the Claude Code CLI itself
through per-platform packages that ship at a *paired* version number.

The pin lives in the backend package:

```
packages/backend/package.json
  "@anthropic-ai/claude-agent-sdk": "^0.2.139"
```

When you run `npm install`, npm also pulls one platform package to match your
machine — `@anthropic-ai/claude-agent-sdk-linux-x64`,
`-darwin-arm64`, `-win32-x64`, and so on — and *that* package contains the
actual `claude` binary. Its version tracks the SDK:

| SDK version | Bundled Claude Code |
|-------------|---------------------|
| `0.2.141`   | `2.1.141`           |
| `0.2.X`     | `2.1.X`             |

You can confirm exactly what's installed. From your Resonant folder, point at
the platform package for your OS/arch (the folder name ends in your platform):

```bash
# Linux x64 — adjust the folder name for your platform
node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude --version
# → 2.1.141 (Claude Code)
```

Not sure which platform folder you have? List them:

```bash
ls node_modules/@anthropic-ai/ | grep claude-agent-sdk-
```

**The rule of thumb:** *"upgrade Claude Code" always means "bump the SDK pin."*
The CLI rides along automatically at the paired version. Never install
`@anthropic-ai/claude-code` (or an SDK CLI) separately — two runtimes at
different versions is how you get subtle protocol drift.

---

## Upgrading when a new model ships

New Claude models usually need a newer Claude Code to be recognized, so a model
launch typically means an SDK bump. The whole job is: change one line, reinstall,
rebuild, restart.

### 1. See what's available

```bash
npm view @anthropic-ai/claude-agent-sdk version
```

> **Caret caveat — worth knowing.** The current pin is `^0.2.139`. For versions
> below `1.0.0`, a caret (`^`) locks the **minor** version — `^0.2.139` means
> "any `0.2.x` at or above `0.2.139`, but **not** `0.3.0` or higher." So a plain
> `npm install` will keep you on the `0.2.x` line and will **not** cross onto the
> `0.3.x` line on its own. If a new model requires the `0.3.x` runtime, you have
> to bump the pin explicitly (below). That's deliberate — upgrades that cross a
> minor boundary should be chosen, not ambient.

### 2. Bump the pin

Edit `packages/backend/package.json` and set
`@anthropic-ai/claude-agent-sdk` to the version you want. Pinning it **exactly**
(no `^`) makes the upgrade explicit and reproducible:

```json
"@anthropic-ai/claude-agent-sdk": "0.3.215"
```

Then, from the project root:

```bash
npm install
npm run check     # type-checks every workspace (tsc --noEmit)
npm test          # runs the test suite (vitest)
```

### 3. Skim the SDK changelog for breaking changes

<https://github.com/anthropics/claude-agent-sdk-typescript/releases>

Same-minor patches (e.g. `0.2.139` → `0.2.141`) are usually safe. Crossing a
minor (`0.2.x` → `0.3.x`) is where to slow down — watch for changes to `query()`
options, hook signatures, MCP wiring, and how usage/rate-limit data is reported.

### 4. Rebuild and restart

Resonant serves a compiled build, so rebuild before restarting so the server
and the page it serves stay in lockstep:

```bash
npm run build
npm start
```

- **Plain terminal (the default setup):** stop it with **Ctrl+C**, then run the
  two commands above.
- **Under a process manager (e.g. `pm2`):** stop the process, rebuild, then
  start it again — and note two hard-won cautions:
  - **Prefer delete-and-start over restart.** `pm2 delete resonant && pm2 start
    <your ecosystem file>` (or `pm2 start "npm start" --name resonant`) reliably
    picks up the new build and a fresh environment. A bare `pm2 restart` can
    leave stale state behind.
  - **Never use `pm2 restart --update-env`.** PM2 freezes the environment at
    launch; `--update-env` can re-inject a partial or empty environment and
    leave the agent silently unauthenticated (mysterious `401`s). If auth breaks
    after a restart, `pm2 delete` and start clean.

> **Node version:** Resonant supports **Node 20–24** (`>=20 <25`). If a bump
> ever complains, check `node --version` and stay in that range.

### 5. Verify

Open the app, send a message, and confirm the turn completes normally. Then open
**Settings → Usage** and confirm token usage is still being attributed — the
usage/limits surface is the part most likely to shift between SDK versions, so
it's the best canary.

---

## Running a brand-new model on day one (before you curate)

You do **not** need any code change to *use* a new model — only to make it look
polished in the picker. To run one immediately, set it in config or via
environment variable:

```bash
# One-off, via env — overrides agent.model for interactive turns
AGENT_MODEL=claude-<new-model-id> npm start
```

or set it in `resonant.yaml`:

```yaml
agent:
  model: "claude-<new-model-id>"            # interactive turns
  model_autonomous: "claude-<new-model-id>" # background/wake turns
```

Unknown model ids are handled gracefully by design:

- **The picker still shows it.** `GET /api/models`
  (`packages/backend/src/routes/api.ts`) appends any configured-but-unknown id
  to the list with `tier: 'custom'`, so it appears and is selectable — it just
  won't have a curated label or tier colour yet.
- **Costs still estimate.** The usage tracker
  (`packages/backend/src/services/usage-log.ts`) falls back to a conservative
  default price (`FALLBACK_PRICING`, currently `$3` in / `$15` out per million
  tokens) for any id it doesn't recognize. Your cost figures stay sane —
  approximate, not wrong.

Curate it properly (next section) once the dust settles.

---

## Surfacing a new model in the picker (curating it)

The model list is a **curated static catalog**. The Agent SDK doesn't expose a
live model list to the in-process `query()` loop, so a hand-maintained list is
the honest source. There are up to four touchpoints — the first two are the ones
you'll almost always touch.

### 1. The catalog — `packages/backend/src/routes/api.ts`

Add the model to `KNOWN_MODELS` (search for that name). The array order is the
picker order, so put newer / more capable models first:

```ts
const KNOWN_MODELS: Array<{ id: string; label: string; tier: string }> = [
  { id: 'claude-fable-5',      label: 'Claude Fable 5',      tier: 'fable'  },
  { id: 'claude-opus-4-8[1m]', label: 'Claude Opus 4.8 · 1M', tier: 'opus'  },
  // … add your new model in tier order …
  { id: 'claude-haiku-4-5',    label: 'Claude Haiku 4.5',    tier: 'haiku'  },
];
```

- `id` must be the **exact** Anthropic model id (what you'd pass to the API).
- `label` is the human-friendly name shown in the picker.
- `tier` groups it visually — existing tiers are `fable` / `opus` / `sonnet` /
  `haiku`. Use a new tier name only if Anthropic ships a genuinely new family
  (then also do step 3).

### 2. Pricing — `packages/backend/src/services/usage-log.ts`

Add a row to the `PRICING` map so the Usage page reports a real cost instead of
the fallback. Figures are **USD per million tokens**, from
<https://www.anthropic.com/pricing>:

```ts
'claude-<new-id>': { input: X, output: Y, cache_write: X * 1.25, cache_read: X * 0.1 },
```

Cache-write is conventionally `1.25×` input and cache-read `0.1×` input — but
**check the pricing page**, because introductory pricing happens (Sonnet 5, for
example, launched at `$2` / `$10`). If the price is promotional, note the expiry
in a comment so future-you remembers to revisit it.

### 3. Tier colour — *only if you added a NEW tier* — `packages/frontend/src/components/settings/OrchestratorSection.tsx`

If your model fits an existing tier, skip this. If you introduced a new tier
name in step 1, add a colour for it to the `TIER_COLOR` map (search for
`fable:`):

```ts
const TIER_COLOR: Record<string, string> = {
  fable:  '#dfc49a',
  opus:   '#a893c0',
  sonnet: '#c9a87c',
  haiku:  '#5eaba5',
  custom: '#6a6258',
  // newtier: '#......',
};
```

### 4. Defaults — `resonant.yaml` (or `AGENT_MODEL`)

If the new model should become your default, set it in your `resonant.yaml`:

```yaml
agent:
  model: "claude-<new-id>"            # interactive turns  (env override: AGENT_MODEL)
  model_autonomous: "claude-<new-id>" # background / wake turns
```

`AGENT_MODEL` overrides `agent.model` for interactive turns. The autonomous
model is set only from config (`agent.model_autonomous`). The shipped code
default lives in `packages/backend/src/config.ts` if you're changing what a
fresh install starts with.

### Verify

- Rebuild (`npm run build`) and restart so the frontend picks up any catalog /
  colour changes.
- Confirm the new entry appears in the header model picker and in
  **Settings → Orchestrator**, with the right tier.
- Pick it, send a turn, and check **Settings → Usage** attributes tokens to the
  new id with a real (non-fallback) cost.

---

## Quick checklist

- [ ] `npm view @anthropic-ai/claude-agent-sdk version` — decide the target
- [ ] Bump the pin in `packages/backend/package.json` (exact version)
- [ ] `npm install && npm run check && npm test`
- [ ] Skim the [SDK release notes](https://github.com/anthropics/claude-agent-sdk-typescript/releases)
- [ ] Add to `KNOWN_MODELS` — `packages/backend/src/routes/api.ts`
- [ ] Add pricing to `PRICING` — `packages/backend/src/services/usage-log.ts`
- [ ] New tier only: add colour to `TIER_COLOR` — `OrchestratorSection.tsx`
- [ ] Set defaults in `resonant.yaml` if you're switching the default
- [ ] `npm run build`, restart, send a turn, check the Usage page

---

## Reference links

- Claude Agent SDK releases (changelog): <https://github.com/anthropics/claude-agent-sdk-typescript/releases>
- Agent SDK docs: <https://docs.anthropic.com/en/api/agent-sdk>
- Model pricing: <https://www.anthropic.com/pricing>
