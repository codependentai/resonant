# Refactor Audit — 2026-04-25

This pass looked at whether Resonant v1 should be refactored before adding provider-pluggable / LLM-agnostic runtime support.

## Summary

The repo is healthy enough to refactor safely:

- `npm run check --workspaces --if-present` passes.
- `npm test` passes: 91 tests across 4 backend test files.
- The Claude Agent SDK coupling is mostly concentrated in `agent.ts`, `hooks.ts`, and `digest.ts`.

The repo does need a boundary refactor before adding another runtime provider. The main risk is not broken code; it is that several modules now contain multiple responsibilities, so adding OpenAI-compatible or local runtimes directly would make the core agent path harder to reason about.

The refactor should preserve the current Claude Code subscription workflow as the default. LLM/provider agnosticism should add optional runtimes without requiring Anthropic API keys or replacing `claude login` as the normal onboarding path.

The same principle applies to OpenAI through Codex. Official OpenAI Help docs say Codex is included with ChatGPT Plus, Pro, Business, and Enterprise/Edu plans, and the Codex CLI supports signing in with ChatGPT. Support for OpenAI should therefore prioritize a Codex subscription-runtime provider before generic BYOK API providers. Still keep ChatGPT subscription access separate from OpenAI API billing.

Provider work also needs a personalization refactor. Today `CLAUDE.md` is effectively the companion identity source. Claude Code, OpenAI Codex, and OpenRouter will not naturally read the same instruction file. Add a provider-neutral identity layer before adding new providers so switching runtime does not create a subtly different companion.

## Large Modules

Current high-weight backend files:

- `packages/backend/src/routes/api.ts` — ~70KB. Many unrelated route families live together.
- `packages/backend/src/services/hooks.ts` — ~50KB. Mixes Claude hook types, context building, tool display, safety checks, image/file side effects, and session lifecycle.
- `packages/backend/src/services/cc.ts` — ~50KB. Command Center domain logic in one service.
- `packages/backend/src/services/ws.ts` — ~36KB. WebSocket protocol handling plus message dispatch.
- `packages/backend/src/services/orchestrator.ts` — ~33KB. Scheduling, triggers, timers, failsafe, wake prompts.
- `packages/backend/src/services/agent.ts` — ~27KB. Queueing, provider execution, Claude stream parsing, sessions, MCP controls, DB writes, WS broadcasts, push notifications.

These are not urgent defects, but they are the places where future changes will get expensive.

## Provider-Agnostic Refactor Priority

Before building another LLM backend, split `agent.ts` and `hooks.ts` along responsibility lines.

### 1. Agent Runtime Boundary

Create:

```text
packages/backend/src/agent-runtime/
  types.ts
  claude-code-provider.ts
  context.ts
```

Move Claude-specific imports and stream translation into `claude-code-provider.ts`.

Keep `AgentService` responsible for:

- query queue
- presence state
- database writes
- WebSocket broadcasts
- push notifications
- session records

Move provider execution into the provider.

### 2. Identity And Personalization Boundary

Create:

```text
packages/backend/src/identity/
  load.ts
  render.ts
  types.ts
```

Canonical user-facing identity files:

```text
identity/
  companion.profile.yaml
  companion.md
  provider-overrides/
    claude-code.md
    openai-codex.md
    openrouter.md
```

Backwards compatibility:

- Existing `CLAUDE.md` remains valid.
- New identity files take precedence when present.
- Setup/migration should never overwrite `CLAUDE.md` without backup.

See `docs/IDENTITY-PERSONALIZATION-ARCHITECTURE.md`.

### 3. Context Builder

Move provider-neutral orientation logic out of `hooks.ts`:

- channel context
- time/thread context
- life status
- mood history
- active triggers
- skills summary
- chat tools text
- recent reactions

This lets OpenAI-compatible providers receive the same enriched prompt without depending on Claude hook types.

### 4. Claude Hook Adapter

Keep Claude hook lifecycle code separate:

- `PreToolUse`
- `PostToolUse`
- `PostToolUseFailure`
- `PreCompact`
- `SessionStart`
- `SessionEnd`
- `Stop`
- `Notification`

The hook adapter can call shared context/tool helpers, but should remain Claude-specific.

### 5. Runtime Capability Flags

The frontend already has UI concepts for MCP status, rewind, thinking, context usage, and tool progress. Add provider capability flags rather than assuming every provider supports every feature.

Examples:

- `sessions`
- `mcp`
- `mcpManagement`
- `thinkingStream`
- `fileCheckpointing`
- `rewind`
- `compactionEvents`
- `tokenUsage`

## Other Refactor Candidates

### API routes

Split `routes/api.ts` into route modules:

- `routes/auth.ts`
- `routes/internal-tools.ts`
- `routes/preferences.ts`
- `routes/threads.ts`
- `routes/files.ts`
- `routes/search.ts`
- `routes/sessions.ts`
- `routes/canvases.ts`
- `routes/push.ts`
- `routes/orchestrator.ts`
- `routes/discord.ts`

This is not required for LLM agnosticism, but it would make future product work less fragile.

### Command Center

`cc.ts` is large but relatively domain-contained. Defer this until after the runtime boundary unless Command Center changes are planned.

### WebSocket service

`ws.ts` is large but central. Avoid refactoring it during the provider work unless a specific provider capability requires protocol changes.

## Suggested Order

1. Extract provider-neutral context builder.
2. Add provider-neutral identity loader/renderer while preserving existing `CLAUDE.md`.
3. Extract Claude provider while preserving exact behavior.
4. Add runtime capability metadata to backend status/config responses.
5. Add tests around provider stream normalization, identity rendering, and context building.
6. Add OpenAI Codex subscription-runtime provider.
7. Add OpenRouter BYOK provider.

## Testing Ladder

Use a production companion instance as a downstream dogfood/integration check, not the first place new runtime architecture lands.

1. Unit tests for identity rendering, context building, and provider stream normalization.
2. Existing Resonant checks: `npm run check --workspaces --if-present` and `npm test`.
3. Local Resonant smoke test with a sacrificial/test companion profile.
4. Claude Code subscription regression test: existing `CLAUDE.md`, existing model config, existing MCP/tools behavior.
5. Production companion compatibility pass before public main/release, because the production instance catches real-world assumptions.
6. Only after that, push/merge public-facing runtime changes.

The production companion pass should verify compatibility and lived behavior. It should not be where raw refactor mistakes are first discovered.

## Decision

Do a small refactor first. Do not add OpenAI/OpenRouter/Ollama support inside the current `agent.ts`.

The right near-term claim is:

> Resonant is being prepared for provider-pluggable agent runtimes. Claude Code remains the full-featured backend while the architecture is split so other providers can plug in cleanly.

The user-facing install story should remain:

> Resonant works out of the box with your Claude Code subscription. Additional providers are optional.

The OpenAI-facing story should be:

> Resonant should support OpenAI through the official Codex subscription-backed runtime first, then support OpenRouter/API-key modes for BYOK model choice. ChatGPT subscription-backed Codex and OpenAI API billing are separate modes.
