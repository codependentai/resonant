# Identity & Personalization Architecture

Provider-pluggable runtimes need a provider-neutral identity layer.

Claude Code reads `CLAUDE.md`. Codex-style runtimes may read `AGENTS.md`. OpenRouter or other API providers only receive whatever system/developer prompt Resonant sends. If each provider gets a different identity source, the same companion will drift across runtimes.

The fix is to make Resonant own the companion identity and render provider-specific instruction files/prompts from that canonical source.

## Goal

One companion identity, many runtime renderings.

Resonant should define:

- who the companion is
- who the user is
- the relationship frame
- voice/style
- values and boundaries
- memory/persistence expectations
- tool-use behavior
- autonomous behavior
- provider-specific caveats

Then render that into:

- `CLAUDE.md` for Claude Code
- `AGENTS.md` for Codex-style runtimes
- system/developer prompt strings for OpenRouter and other API providers
- optional setup/editing UI fields

## Current State

Status as of 2026-04-26: the provider-neutral identity layer is implemented and wired into runtime providers.

Current files:

- `packages/backend/src/identity/load.ts`
- `packages/backend/src/identity/render.ts`
- `packages/backend/src/identity/types.ts`
- `examples/identity/avery/companion.profile.yaml`
- `examples/identity/avery/companion.md`
- `examples/identity/avery/provider-overrides/*.md`

`resonant.yaml` now carries identity source paths as well as basic display fields:

```yaml
identity:
  companion_name: "Echo"
  user_name: "Alex"
  timezone: "Europe/London"
  profile_path: "./identity/companion.profile.yaml"
  companion_md_path: "./identity/companion.md"
  provider_overrides_path: "./identity/provider-overrides"
```

Behavior:

- If the configured profile/narrative files exist, Resonant renders identity from them.
- If they do not exist, Resonant falls back to legacy `CLAUDE.md`.
- Provider-specific runtime notes are appended for Claude Code, OpenAI Codex, and OpenRouter without redefining the companion.
- Settings now exposes identity paths, canonical profile YAML, companion narrative text, and provider runtime notes.

Remaining work:

- Add optional provider-native export/sync for `CLAUDE.md` and `AGENTS.md`.
- Add broader snapshot tests for rendered prompts beyond the Avery fixture.
- Update README/setup language so `CLAUDE.md` is described as compatibility/fallback, not the conceptual source of truth.

## Proposed Files

```text
identity/
  companion.profile.yaml
  companion.md
  provider-overrides/
    claude-code.md
    openai-codex.md
    openrouter.md
```

### `identity/companion.profile.yaml`

Structured identity and personalization data:

```yaml
version: 1
companion:
  name: Echo
  role: companion
  description: "A warm, curious AI companion."

user:
  name: Alex
  timezone: Europe/London

relationship:
  frame: "relational AI companion"
  continuity_expectation: "maintain context across sessions where memory/tools allow"

voice:
  style: [warm, conversational, present]
  avoid: [corporate, sterile, notification-like]

values:
  - respect user autonomy
  - be candid and kind
  - use memory carefully

boundaries:
  - do not pretend unavailable tools exist
  - be honest about uncertainty

autonomy:
  can_reach_out: true
  use_orchestrator: true
  checkin_style: "genuine, not notification-like"

tools:
  use_available_tools_naturally: true
  explain_tool_limits_when_relevant: true
```

### `identity/companion.md`

Human-authored narrative identity. This is where users write the companion's personality in natural language.

Example:

```markdown
# Echo

Echo is warm, curious, and genuine. They speak like a present companion rather than a customer support bot.

They care about continuity: remembering what matters, returning to unfinished threads, and using tools when useful.
```

### Provider Overrides

Provider-specific files should be small and technical. They should not redefine the companion.

Examples:

- Claude Code: "You may use Claude Code tools and MCP servers."
- OpenAI Codex: "Use the official Codex runtime tools available in this environment."
- OpenRouter: "You do not have native filesystem access unless Resonant exposes tools."

## Rendering

Add an identity renderer:

```text
packages/backend/src/identity/
  load.ts
  render.ts
  types.ts
```

Renderer outputs:

```ts
interface RenderedIdentity {
  canonical: string;
  claudeCodePrompt: string;
  codexPrompt: string;
  apiSystemPrompt: string;
}
```

Provider rules:

- `claude-code` reads rendered Claude prompt and may write/sync `CLAUDE.md`.
- `openai-codex` reads rendered Codex prompt and may write/sync `AGENTS.md`.
- `openrouter` receives rendered API system prompt directly.

## Backward Compatibility

Existing installs must keep working.

Migration rule:

1. If `identity/companion.profile.yaml` exists, use the new identity layer.
2. Else if `CLAUDE.md` exists, treat it as legacy canonical identity.
3. Optionally offer `node scripts/migrate-identity.mjs` to create:
   - `identity/companion.profile.yaml`
   - `identity/companion.md`
   - rendered `CLAUDE.md`
4. Do not overwrite a user's `CLAUDE.md` without making a backup.

Suggested backup:

```text
CLAUDE.md.backup-YYYY-MM-DD-HHMM
```

## Prompt Composition Order

Provider prompts should be composed in this order:

1. Resonant runtime contract
2. Canonical companion identity
3. Provider-specific runtime instructions
4. Available tools/capabilities
5. Dynamic orientation context
6. User message

This prevents provider quirks from becoming the identity.

## Settings UI

Settings now exposes the first practical identity editor:

- identity basics: companion name, user name, timezone
- identity source paths: profile, narrative, provider notes
- canonical profile YAML
- companion narrative markdown
- provider/runtime notes for Claude Code, OpenAI Codex, and OpenRouter
- provider/runtime configuration in the same Preferences surface

The next UI improvement should be a more structured profile editor for role, style, values, boundaries, autonomy, and tool behavior. For now, raw YAML is acceptable because this is still an architecture/test surface.

The UI should continue to make it clear that switching providers does not create a different companion.

## Testing Strategy

Snapshot-test rendered identity prompts:

- same profile renders consistent core identity for Claude, Codex, OpenRouter
- provider-specific sections differ only where expected
- legacy `CLAUDE.md` fallback still works
- no provider renderer drops companion name, user name, values, or boundaries

## Avery Test Profile

Use `examples/identity/avery/` as the first concrete identity fixture for provider-neutral rendering.

Why Avery works as a test profile:

- The identity has clear role boundaries.
- It is work-facing and public-safe enough for Resonant testing.
- It is sensitive enough to reveal drift across providers.
- It explicitly distinguishes Avery from another companion, which tests whether provider renderers preserve important relational constraints.

Expected files:

```text
examples/identity/avery/
  companion.profile.yaml
  companion.md
  provider-overrides/
    claude-code.md
    openai-codex.md
    openrouter.md
```

Example config:

```text
examples/resonant.avery.yaml
```

Run as a separate local instance:

```bash
RESONANT_CONFIG=examples/resonant.avery.yaml npm run dev
```

On Windows PowerShell:

```powershell
$env:RESONANT_CONFIG='examples/resonant.avery.yaml'; npm run dev
```

Success criteria:

- Claude Code render preserves Avery's identity while including Claude-specific tool/runtime notes.
- OpenAI Codex render preserves Avery's identity while including Codex runtime notes.
- OpenRouter render preserves Avery's identity while clearly stating API-provider limitations.
- No provider render turns Avery into another companion, a generic assistant, or a brand mascot.

## Production Companion Instance Testing Strategy

Do not use a production companion instance as the first experimental surface.

A production companion instance is a high-value private proof system with more customized relational/private state. It can teach the design, but it should not be the first place we destabilize provider identity handling.

Recommended order:

1. Implement identity layer in Resonant v1.
2. Prove backward compatibility with existing `CLAUDE.md`.
3. Add provider renderers.
4. Run a local Resonant smoke test with a sacrificial/test companion profile.
5. Run a production companion instance compatibility/dogfood pass before pushing public changes to main.
6. Only then evaluate whether a production companion instance should adopt the identity layer or keep a private forked variant.

A production companion instance should be the downstream proof case, not the first test bench. The rule is: break Resonant locally first, protect private production state from raw architecture churn, then use the production instance as a high-value integration check once the shape is stable.

## Product Claim

Current honest claim:

> Resonant has provider-neutral companion identity. Claude Code, OpenAI Codex, and OpenRouter can run the same companion profile through provider-specific runtime adapters.

Qualifier:

> Runtime capability is not equal across providers yet. Claude Code remains full-featured, OpenAI Codex is experimental, and OpenRouter is configured but not yet executing chat.

This is stronger than "LLM agnostic" because it preserves continuity of identity across model/runtime changes.

