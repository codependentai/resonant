# Provider-Pluggable Runtime Architecture

Resonant v2.2.0 has a provider-pluggable runtime layer. Claude Code remains the default full-featured runtime because it provides sessions, streaming, MCP server integration, hooks, Claude Code tools, file checkpointing, rewind, compaction events, local skills, and permission behavior.

The goal is runtime portability without flattening the companion into plain chat. Other runtimes can run the same Resonant companion shell only where their capability contract is honest and explicit.

For the repo-wide normalization checklist, see [`PROVIDER-NEUTRAL-NORMALIZATION.md`](PROVIDER-NEUTRAL-NORMALIZATION.md). That document expands this plan beyond the main chat runtime to cover hooks/lifecycle events, tools, MCP, skills, sessions, background agents, settings, frontend capability labels, and docs. Research notes from primary framework/protocol docs are in [`PROVIDER-NEUTRAL-RESEARCH-NOTES.md`](PROVIDER-NEUTRAL-RESEARCH-NOTES.md).

## Implementation Status - v2.2.0 / 2026-05-01

The first architecture slice has landed. Resonant is no longer shaped as one monolithic Claude/Codex branch in `AgentService`; it now has a runtime provider layer and explicit provider selection.

Shipped:

- `packages/backend/src/runtime/types.ts` defines `RuntimeProviderId`, `RuntimeCapabilities`, `RuntimeQuery`, `RuntimeEvent`, and `RuntimeProvider`.
- `packages/backend/src/runtime/provider-manager.ts` owns provider lookup.
- `packages/backend/src/runtime/providers/claude-code-provider.ts` contains Claude SDK execution, MCP status, session listing, rewind, thinking, usage, compaction, and rate-limit normalization.
- `packages/backend/src/runtime/providers/openai-codex-provider.ts` contains the experimental Codex CLI runtime path, JSONL parsing, permission modes, and the first provider-neutral tool loop.
- `packages/backend/src/runtime/providers/openrouter-provider.ts` exists as a planned/stub adapter.
- `AgentService` now resolves provider/model selection and consumes normalized runtime events.
- `digest.ts` routes background text summarization through `runtime/text-query.ts` instead of importing the Claude SDK directly.
- Settings exposes interactive/autonomous provider selection, Codex permission, OpenRouter config/key management, identity editing, Scribe provider/model/path settings, Push/VAPID settings, Discord, and Telegram gateway configuration.

Still partial:

- Claude hook code still lives partly in `services/hooks.ts`, but orientation context is now shared through neutral lifecycle helpers.
- OpenAI Codex works as an experimental subscription runtime but does not have native sessions, MCP, rewind, or broad registry-backed tools.
- OpenRouter has settings and key management but no streaming API execution yet.
- Provider/model catalogs are still partly hardcoded in the frontend.
- Non-Claude continuity now has the beginning of a Resonant-owned context path through identity rendering, local sessions, digests, and semantic search, but provider parity is not complete.

## Goal

Support multiple agent providers behind one internal contract, in this priority order:

1. Claude Agent SDK remains the richest/default provider and continues to support Claude Code subscription auth.
2. OpenAI Codex subscription runtime supports ChatGPT Plus/Pro/Business/Enterprise/Edu-backed usage where the official Codex CLI/SDK supports it.
3. OpenRouter BYOK provides broad API-based model choice.
4. Other OpenAI-compatible/local providers can be added without rewriting the UI, orchestrator, database, or Command Center.

This should be framed as **runtime agnostic**, not merely **model agnostic**. The runtime is what decides whether the companion can use tools, resume sessions, compact context, inspect files, or call MCP servers.

## Non-Negotiable: Preserve Subscription Modes Where Officially Supported

Resonant's current setup works through Claude Code login rather than requiring users to provide an Anthropic API key. That is a major accessibility and positioning advantage and must remain the default path.

Provider-pluggable architecture must not remove or demote this mode:

- Fresh installs should still default to `agent.provider: "claude-code"`.
- The setup wizard should still guide users through `claude login`, not API-key setup.
- `claude-code` should remain the full-featured provider in docs and UI.
- API-key providers should be optional additions for users who explicitly choose them.
- Existing installs with no provider configured must behave exactly as they do now.

The intent is to add runtime choices, not to make Claude Code subscription users second-class.

The same product principle applies to OpenAI. OpenAI's Codex documentation says Codex is included with ChatGPT Plus, Pro, Business, and Enterprise/Edu plans, and the Codex CLI supports signing in with ChatGPT. Resonant should therefore treat an official Codex-backed runtime as the second priority after Claude Code.

However, ChatGPT subscriptions and OpenAI API billing remain separate. ChatGPT Plus/Pro should not be documented as a general OpenAI API substitute.

OpenAI support should therefore have two lanes:

- **OpenAI Codex provider** — subscription/login-backed through the official Codex CLI/SDK/runtime path, where available.
- **OpenAI API provider** — uses `OPENAI_API_KEY` / Platform billing and is optional.

Do not use unofficial ChatGPT web scraping, browser-session tokens, or reverse-engineered subscription access to make OpenAI "subscription mode" work.

Reference sources checked 2026-04-25:

- OpenAI Help: "Using Codex with your ChatGPT plan" — Codex included with ChatGPT Plus, Pro, Business, Enterprise/Edu; Codex CLI can sign in with ChatGPT.
- OpenAI Help: "Codex CLI and Sign in with ChatGPT" — login flow links ChatGPT identity and can create local credentials without manual API-key copy/paste.
- OpenAI Help: ChatGPT subscription/API billing articles — ChatGPT subscriptions and API billing are separate.

## Current Coupling Points

The hard dependency lives mostly in `packages/backend/src/services/agent.ts` and `packages/backend/src/services/hooks.ts`.

### `agent.ts`

Claude SDK owns:

- `query()`
- `listSessions()`
- `AbortError`
- `Options`
- `Query`
- `McpServerConfig`
- session `resume`
- `mcpServerStatus()`
- `reconnectMcpServer()`
- `toggleMcpServer()`
- `rewindFiles()`
- `enableFileCheckpointing`
- `systemPrompt: { type: 'preset', preset: 'claude_code' }`
- `plugins: [{ type: 'local', path: ... }]`
- `hooks`
- streamed message types such as `assistant`, `result`, `system`, `stream_event`, `tool_progress`, and `rate_limit_event`

### `hooks.ts`

Hooks are typed against the Claude Agent SDK and assume Claude hook lifecycle events:

- `PreToolUse`
- `PostToolUse`
- `PostToolUseFailure`
- `PreCompact`
- `SessionStart`
- `SessionEnd`
- `Stop`
- `Notification`

But much of the useful logic is provider-neutral:

- orientation context construction
- life status injection
- mood history injection
- active trigger summary
- skill discovery text
- chat tool instructions
- recent reactions
- file auto-share behavior
- tool display name cleanup
- image tool result handling
- audit logging
- destructive command guard logic

## Proposed Internal Boundary

The provider interface now lives under:

```text
packages/backend/src/runtime/
  types.ts
  capabilities.ts
  selection.ts
  provider-manager.ts
  text-query.ts
  providers/
    claude-code-provider.ts
    openai-codex-provider.ts
    openrouter-provider.ts
```

Provider-neutral lifecycle/context helpers live under:

```text
packages/backend/src/runtime-lifecycle/
  types.ts
  context-builder.ts
```

Provider-neutral identity lives under:

```text
packages/backend/src/identity/
  load.ts
  render.ts
  types.ts
```

The existing `AgentService` should become orchestration glue:

- queueing
- presence updates
- database writes
- WebSocket broadcasts
- push notifications
- session records
- provider selection

The provider should own only provider-specific execution.

## Provider Contract

```ts
export type RuntimeProviderId =
  | 'claude-code'
  | 'openai-codex'
  | 'openai-compatible'
  | 'openrouter'
  | 'ollama';

export interface RuntimeMessage {
  type:
    | 'text_delta'
    | 'thinking_delta'
    | 'tool_use'
    | 'tool_result'
    | 'tool_progress'
    | 'context_usage'
    | 'compaction'
    | 'rate_limit'
    | 'session'
    | 'error'
    | 'done';
  text?: string;
  toolId?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  isError?: boolean;
  tokensUsed?: number;
  contextWindow?: number;
  sessionId?: string;
  raw?: unknown;
}

export interface RuntimeQueryOptions {
  threadId: string;
  prompt: string;
  systemPrompt: string;
  cwd: string;
  model: string;
  sessionId?: string | null;
  isAutonomous: boolean;
  platform: 'web' | 'discord' | 'telegram' | 'api';
  abortController: AbortController;
}

export interface AgentRuntimeProvider {
  id: RuntimeProviderId;
  label: string;
  capabilities: RuntimeCapabilities;

  run(options: RuntimeQueryOptions): AsyncIterable<RuntimeMessage>;
  listSessions?(limit?: number): Promise<unknown[]>;
  getMcpStatus?(): Promise<McpServerInfo[]>;
  reconnectMcpServer?(name: string): Promise<{ success: boolean; error?: string }>;
  toggleMcpServer?(name: string, enabled: boolean): Promise<{ success: boolean; error?: string }>;
  rewindFiles?(userMessageId: string, dryRun?: boolean): Promise<RewindResult>;
}

export interface RuntimeCapabilities {
  sessions: boolean;
  mcp: boolean;
  mcpManagement: boolean;
  localSkills: boolean;
  shellTools: boolean;
  fileCheckpointing: boolean;
  rewind: boolean;
  hooks: boolean;
  compactionEvents: boolean;
  thinkingStream: boolean;
  tokenUsage: boolean;
}
```

The UI already has graceful places to degrade:

- MCP settings can show unsupported instead of connected/failed.
- Rewind can be disabled when unavailable.
- Thinking blocks can disappear if a provider does not expose reasoning.
- Context usage can be unknown.
- Tool visualization can still work for provider-managed tools or MCP calls.

## Configuration Shape

Current provider selection in `resonant.yaml`:

```yaml
agent:
  provider: "claude-code"
  autonomous_provider: "claude-code"
  model: "claude-sonnet-4-6"
  model_autonomous: "claude-sonnet-4-6"
  cwd: "."
  claude_md_path: "./CLAUDE.md"
  mcp_json_path: "./.mcp.json"
  claude_code:
    mcp_json_path: "./.mcp.json"

  openai_codex:
    permission: "workspace-write"

  openrouter:
    base_url: "https://openrouter.ai/api/v1"
    api_key_env: "OPENROUTER_API_KEY"
    default_model: ""

scribe:
  enabled: true
  provider: "claude-code"
  model: "claude-sonnet-4-6"
  digest_path: "./data/digests"
```

For backward compatibility:

- If `agent.provider` is missing, use `claude-code`.
- Existing `agent.model` and `agent.model_autonomous` continue to work.
- No Anthropic API key is required for the `claude-code` provider; it uses the existing Claude Code authentication state.
- Do not imply that a ChatGPT subscription covers OpenAI API usage. Keep `openai_codex` separate from `openai_api`, `openrouter`, and generic `openai_compatible` configuration.

## Identity And Personalization

Provider-pluggable runtimes also require provider-neutral companion identity.

Resonant now uses provider-neutral identity files as the canonical identity layer:

- `identity/companion.profile.yaml`
- `identity/companion.md`
- `identity/provider-overrides/*`

Legacy `CLAUDE.md` remains supported as a fallback for existing installs and Claude Code compatibility. Provider-specific render notes let Claude Code, OpenAI Codex, OpenRouter, and future API providers receive the same companion identity with runtime-appropriate limits.

```text
identity/
  companion.profile.yaml
  companion.md
  provider-overrides/
    claude-code.md
    openai-codex.md
    openrouter.md
```

Backward compatibility rule:

1. If the new identity files exist, use them.
2. Otherwise, keep using existing `CLAUDE.md`.
3. Never overwrite a user's existing `CLAUDE.md` without backup.

See `docs/IDENTITY-PERSONALIZATION-ARCHITECTURE.md`.

## Implementation Phases and Remaining Work

### Phase 1 — Extract Provider-Neutral Core And Identity (shipped)

No behavior change.

1. Move Claude SDK imports out of `agent.ts` into `runtime/providers/claude-code-provider.ts`.
2. Create `RuntimeMessage` and `AgentRuntimeProvider` types.
3. Make Claude provider translate Claude SDK stream events into `RuntimeMessage`.
4. Keep the same frontend protocol and DB writes.
5. Keep `createHooks()` only inside the Claude provider for now.
6. Add identity loading/rendering structure while preserving legacy `CLAUDE.md` behavior.

Success criterion: `npm run build`, existing tests pass, Claude behavior unchanged.

### Phase 2 — Split Context From Claude Hooks And Rendered Identity (mostly shipped)

Move provider-neutral context building into `runtime-lifecycle/context-builder.ts`:

- `buildOrientationContext`
- life status fetch
- mood history fetch
- skill summaries
- chat tool instruction block
- reaction summaries

Keep Claude-specific hook wrappers in `hooks.ts`, but make them call provider-neutral helpers.

Success criterion: a non-Claude provider can build the same enriched prompt and same companion identity even before it supports native hooks.

### Phase 3 — Add OpenAI Codex Subscription Runtime (experimental)

Add a provider using the official OpenAI Codex CLI/SDK/runtime path, preserving ChatGPT Plus/Pro subscription access where supported.

Minimum behavior:

- enriched system/user prompt
- streaming text
- abort
- token/credit usage when available
- DB persistence through existing `AgentService`

This provider does not initially support:

- file checkpointing
- rewind
- Claude Code plugins
- Claude hook lifecycle
- native Claude Code shell tools

Success criterion: users can select `openai_codex`, authenticate through the official Codex login/runtime path, and hold a normal chat through the existing Resonant UI without manually configuring `OPENAI_API_KEY`.

### Phase 4 — Add OpenRouter BYOK Runtime

Add a provider using OpenRouter's OpenAI-compatible API surface.

Minimum behavior:

- enriched system/user prompt
- streaming text
- abort
- model selection
- token usage when available
- DB persistence through existing `AgentService`

Success criterion: users can select `openrouter`, provide `OPENROUTER_API_KEY`, choose a model, and hold a normal chat through the existing Resonant UI.

### Phase 5 — Add Tools And MCP For Non-Claude Providers

There are two viable routes.

#### Route A: MCP Tool Bridge

Resonant acts as an MCP client, loads `.mcp.json`, exposes MCP tools to the model through provider-native tool calling, and executes calls itself.

Pros:

- True provider independence.
- Tool visualization can remain consistent.
- Command Center MCP tools work outside Claude.

Cons:

- Requires implementing MCP client lifecycle in Resonant.
- Needs careful sandboxing and timeout/error behavior.
- Some stdio MCP servers may have auth/env quirks.

#### Route B: Internal Tool Registry First

Expose only Resonant's own tools first:

- Command Center tools
- `sc` capabilities rewritten as direct backend functions
- semantic search
- timers/triggers/routines
- file share/canvas/reactions

Pros:

- Smaller first step.
- Avoids full MCP complexity.
- Covers the companion-specific value proposition.

Cons:

- External `.mcp.json` support remains Claude-only until Route A.

Recommended: Route B first, then Route A.

### Phase 6 — Session And Memory Strategy

Claude SDK sessions are not portable. Provider-neutral sessions should be Resonant-owned:

- thread history from SQLite
- digest summaries
- semantic search retrieval
- optional Resonant Mind integration
- periodic compaction summaries saved to DB

For Claude provider:

- keep SDK `resume` because it is useful.

For other providers:

- construct conversation context from Resonant's own stored thread state.
- inject summaries/retrieval instead of relying on provider sessions.

This makes Resonant stronger even for Claude, because continuity becomes product-owned rather than runtime-owned.

## Capability Matrix

| Capability | Claude Code | OpenAI Codex | OpenRouter BYOK | API Providers + Tools |
|---|---:|---:|---:|
| Streaming chat | yes | experimental | planned | planned |
| Subscription/login auth | yes | yes | no | provider-dependent |
| API key / BYOK | no | no | yes | yes |
| Companion orientation context | yes | yes | yes | yes |
| Resonant DB/thread persistence | yes | yes | yes | yes |
| Autonomous wakes | yes | experimental | blocked until runtime execution | planned |
| Command Center context | yes | yes | yes | yes |
| Thinking stream | yes | provider-dependent | provider-dependent | provider-dependent |
| Claude Code tools | yes | no | no | no |
| Local skills plugin | yes | prompt-only | prompt-only | prompt-only |
| MCP tools | yes | registry/adapter-limited | no initially | yes, if MCP bridge added |
| MCP status/toggle | yes | unsupported today | no | partial |
| File checkpointing/rewind | yes | provider-dependent | no | no unless separately implemented |
| Hook lifecycle | yes | emulated | emulated | emulated |
| Compaction events | yes | provider-dependent | no | Resonant-owned summaries |

## Product Language

Current public language:

> Resonant has provider-pluggable companion runtimes. Claude Code remains the default full-featured runtime, OpenAI Codex is experimental, and OpenRouter settings/key management are available for BYOK planning while chat execution is still pending.

For install/onboarding language:

> The default Resonant experience runs through your local Claude Code login. Advanced users can optionally select OpenAI Codex experimentally or configure OpenRouter settings for future BYOK model routing.

For OpenAI language:

> Resonant separates OpenAI Codex subscription-runtime support from OpenAI API-key support. ChatGPT Plus/Pro can be used where the official Codex runtime supports it; OpenAI API usage remains a separate Platform-billed mode.

Do not claim OpenRouter chat support until the adapter can execute streamed chat with the same identity/context contract and clearly labeled tool limits.

## Risks

- Lowest-common-denominator design would weaken Resonant. Avoid flattening everything to plain chat.
- Tool/security behavior must be explicit per provider.
- MCP status management will not map cleanly across runtimes.
- Users may assume every provider supports every feature unless the UI labels capability differences clearly.
- Claude Code's built-in memory/session behavior must not be treated as equivalent to OpenAI-compatible stateless calls.

## Recommended Next PR

This first PR/slice has effectively been implemented under `packages/backend/src/runtime/`.

Recommended next PR:

- convert `services/hooks.ts` into a Claude-specific adapter over `runtime-lifecycle/context-builder.ts`
- move tool audit/display/safety helpers into neutral lifecycle/tool modules
- add tests that prove Claude behavior did not regress while removing duplicate context code
- expand registry-backed tool handlers before attempting real OpenRouter execution

That keeps the architecture moving without pretending OpenRouter is ready before the context/tool contract is strong enough.
