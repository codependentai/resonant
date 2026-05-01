# Provider-Neutral Normalization Map

This document maps the parts of Resonant that need to become provider-neutral before the product can honestly support Claude Code, OpenAI Codex, OpenRouter, and future runtimes without feature drift.

The goal is not to flatten Resonant to plain chat. The goal is to make Resonant own its companion layer, then adapt that layer to each runtime.

Research confirmation from primary framework/protocol docs lives in [`PROVIDER-NEUTRAL-RESEARCH-NOTES.md`](PROVIDER-NEUTRAL-RESEARCH-NOTES.md).

## Status Snapshot - 2026-04-26

Key: **shipped** means implemented and passing the local test suite; **partial** means usable scaffolding exists but the capability is not complete; **not started** means still design-only.

| Area | Status | Current truth |
|---|---|---|
| Runtime provider interface | **shipped** | `packages/backend/src/runtime/types.ts`, `provider-manager.ts`, `selection.ts`, and `capabilities.ts` now exist. `AgentService` consumes normalized `RuntimeEvent`s. |
| Claude Code provider | **shipped / partial cleanup** | Claude SDK execution moved into `runtime/providers/claude-code-provider.ts`. Claude remains the default full-featured provider. `agent.ts` still imports a Claude SDK MCP type, and Claude hook logic still lives in `services/hooks.ts`. |
| OpenAI Codex provider | **partial / experimental** | `runtime/providers/openai-codex-provider.ts` shells through `codex exec --json`, supports permission modes, emits normalized text/usage/tool events, and can run handler-backed registry tools through a fenced `resonant-tool-call` loop. It does not have native MCP, rewind, provider sessions, or a full structured tool implementation yet. |
| OpenRouter provider | **partial / planned runtime** | OpenRouter appears in provider capability metadata and Preferences now includes base URL, default model, API key env name, and write-only API key management. Runtime execution is still a stub and must not be claimed as supported chat yet. |
| Identity layer | **shipped** | Canonical profile/narrative/provider override loading exists in `packages/backend/src/identity/*`, with legacy `CLAUDE.md` fallback and an Avery test profile under `examples/identity/avery/`. Preferences now exposes identity paths and editable identity text. |
| Context/lifecycle extraction | **partial** | `runtime-lifecycle/context-builder.ts` exists and is used by `AgentService` and orchestrator life-status checks. `services/hooks.ts` still contains duplicated legacy context/hook code and needs to become a Claude adapter over the neutral lifecycle helpers. |
| Internal tool registry | **partial** | `packages/backend/src/tools/internal-registry.ts` defines the first registry shape and metadata. `timer.list`, `timer.create`, and `timer.cancel` have direct handlers. Many tools are registered for metadata/compatibility but still return unsupported through the provider-neutral executor. |
| Command Center tools | **partial** | Command Center tool names are represented in the registry, but CC handlers are not yet registry-backed. `/mcp/cc` remains the working compatibility surface. |
| Scribe/digest | **shipped / provider-limited** | `digest.ts` no longer imports the Claude SDK directly and uses `runtime/text-query.ts`. It can run through implemented providers; OpenRouter remains blocked until the OpenRouter adapter is real. |
| Settings/model picker | **partial** | `agent.provider`, `agent.autonomous_provider`, Codex permission, provider capabilities, OpenRouter config, and identity editing are exposed. Model lists are still mostly hardcoded and need backend-driven provider/model catalog metadata. |
| WebSocket/UI event normalization | **partial** | Runtime events are normalized in the provider layer and mapped by `AgentService`. Claude emits the richest stream. Codex emits text/usage and registry tool cards. Capability-specific unsupported states still need sharper UI labels. |
| Provider-neutral continuity | **not started** | Claude native resume remains useful. Non-Claude providers still need a Resonant-owned context assembler from DB history, digests, and semantic search. |

## Current Next Slice

The next highest-leverage slice is **not** adding more model names. It is consolidating the provider-neutral foundation that already landed:

1. Turn `services/hooks.ts` into a Claude-specific adapter over `runtime-lifecycle/*`.
2. Move tool display/audit/safety helpers out of Claude hook code into neutral lifecycle/tool modules.
3. Expand the internal tool registry handlers for share, canvas, reaction, semantic search, routines, pulse, failsafe, triggers, Telegram, and Command Center.
4. Make `tools/sc.mjs` and `/api/internal/*` compatibility surfaces over the same registry behavior where possible.
5. Add mocked runtime adapter tests for Claude event normalization, Codex JSONL normalization, and provider-neutral tool execution.
6. Only then implement OpenRouter streaming text, because the tool/context contract will be clearer.

## Core Principle

Resonant should own:

- companion identity and personalization
- prompt composition and orientation context
- tool definitions, execution, audit, and UI events
- session and continuity strategy
- autonomous wake behavior
- capability detection and UI labels
- model/provider configuration

Provider runtimes should own only:

- model execution
- provider-native streaming format
- provider-native auth
- provider-native tools where useful
- provider-native session features where available

This means Claude Code can remain the richest/default provider while the product no longer depends on Claude-specific hooks, files, tools, or session semantics for its core concept.

## Current Coupling Inventory

### Main Agent Runtime

Current files:

- `packages/backend/src/services/agent.ts`
- `packages/backend/src/services/hooks.ts`

Current state:

- `agent.ts` imports `@anthropic-ai/claude-agent-sdk` directly.
- `agent.ts` now also shells out to `codex exec` for OpenAI Codex subscription testing.
- Provider selection is inferred from model names instead of explicit provider config.
- Claude stream events, Codex JSONL events, session storage, DB persistence, WebSocket broadcasting, queueing, and push notifications all live in one service.
- MCP management, file rewind, checkpointing, and active query state assume Claude SDK features.

Normalization target:

- Move provider-specific execution into provider adapters.
- Keep `AgentService` as orchestration glue only.
- Normalize all provider output into one internal event stream.

Current target/implementation:

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

### Hooks And Lifecycle Events

Current file:

- `packages/backend/src/services/hooks.ts`

Current state:

- The word "hooks" currently means Claude Agent SDK hooks.
- The same file also contains provider-neutral orientation logic.
- `createHooks()` is Claude-specific.
- `buildOrientationContext()` is mostly provider-neutral.
- Tool audit, tool display names, image handling, file sharing, destructive command checks, and compaction preservation are mixed with Claude hook callback types.

Normalization target:

Split this concept into two layers:

```text
packages/backend/src/runtime-lifecycle/
  types.ts
  lifecycle-events.ts
  context-builder.ts
  tool-event-handlers.ts
  safety.ts
  claude-hooks-adapter.ts
```

Provider-neutral lifecycle stages:

- `before_prompt`: build dynamic orientation before the model sees the prompt.
- `tool_requested`: validate and display a tool request.
- `tool_completed`: audit and display a tool result.
- `tool_failed`: audit and surface a tool failure.
- `before_compaction`: preserve emotional/thread continuity.
- `session_started`: create or resume runtime context.
- `session_ended`: save handoff state.
- `notification`: normalize provider notices and rate limits.

Claude Code can map these to native SDK hooks. Codex/OpenRouter can emulate them inside the runtime adapter.

### Identity And Personalization

Current files:

- `packages/backend/src/identity/load.ts`
- `packages/backend/src/identity/render.ts`
- `packages/backend/src/identity/types.ts`
- `docs/IDENTITY-PERSONALIZATION-ARCHITECTURE.md`

Current state:

- This is already moving in the right direction.
- Legacy `CLAUDE.md` fallback exists.
- Provider renders exist for `claude-code`, `openai-codex`, `openrouter`, `openai-api`, and `openai-compatible`.

Remaining normalization:

- Make prompt composition order explicit in code, not just docs.
- Stop treating `CLAUDE.md` as the mental default in README/setup language.
- Add snapshot tests for provider renders.
- Add optional sync/export to provider-native files only as compatibility output, not source of truth.

Canonical order:

1. Resonant runtime contract
2. Canonical companion identity
3. Provider-specific runtime notes
4. Capability/tool instructions
5. Dynamic orientation context
6. User/autonomous prompt

### Tools

Current files:

- `tools/sc.mjs`
- `packages/backend/src/routes/api.ts`
- `packages/backend/src/routes/cc-mcp.ts`
- `packages/backend/src/services/hooks.ts`
- `docs/TOOLS.md`

Current state:

- Resonant tools are mostly exposed as localhost API endpoints wrapped by `tools/sc.mjs`.
- Claude sees these through Bash instructions injected into orientation context.
- Codex can only use them if shell permissions allow `node tools/sc.mjs`.
- Command Center has an MCP endpoint, but Resonant itself is not yet using a provider-neutral tool registry.
- Tool UI cards are mostly driven by Claude `PreToolUse` / `PostToolUse` hooks.

Normalization target:

Create a Resonant-owned tool registry:

```text
packages/backend/src/tools/
  types.ts
  registry.ts
  execute.ts
  resonant-tools.ts
  command-center-tools.ts
  mcp-tool-bridge.ts
```

Each tool should define:

- stable name, e.g. `resonant.timer.list`
- description
- JSON schema
- permission level
- read/write/destructive hints
- timeout
- handler
- result serializer

Then expose the same tool set through:

- Claude SDK MCP/native tools or Bash fallback
- Codex structured tool calls or backend-mediated requests
- OpenRouter function calling where supported
- JSON tool-call fallback for models without native tools
- `tools/sc.mjs` as a CLI client, not the core integration contract

### MCP

Current files:

- `packages/backend/src/routes/cc-mcp.ts`
- `packages/backend/src/services/agent.ts`
- `packages/frontend/src/lib/components/McpActivityPanel.svelte`
- `packages/shared/src/types.ts`

Current state:

- Claude provider loads `.mcp.json` and manages MCP through the Claude SDK.
- UI assumes MCP server status is meaningful globally.
- Command Center exposes MCP tools but those tools are not first-class internal registry tools.

Normalization target:

- Split "external MCP status" from "Resonant internal tools".
- Add capability labels: `native`, `bridged`, `unsupported`.
- Keep Claude `.mcp.json` support as a provider-native feature.
- Add a later Resonant MCP client if we want external MCP tools to work across providers.
- Convert Command Center tool definitions into internal tool registry definitions, then optionally export them as MCP.

### Skills And Slash Commands

Current files:

- `packages/backend/src/services/hooks.ts`
- `packages/backend/src/services/commands.ts`

Current state:

- Skills scan `config.agent.cwd/.claude/skills`.
- Custom commands scan `config.agent.cwd/.claude/commands`.
- Orientation text says skills should be read with Bash.
- SDK commands like `/compact` and `/clear` are passed through as prompt text and assume Claude semantics.

Normalization target:

Use provider-neutral directories as the canonical source:

```text
skills/
commands/
```

Provider-native exports can be generated or mirrored:

```text
.claude/skills/
.claude/commands/
.codex/skills/
AGENTS.md
```

Commands should be classified:

- UI-owned commands
- Resonant-owned commands
- provider-native commands
- unsupported for current provider

### Sessions, Memory, And Continuity

Current files:

- `packages/backend/src/services/agent.ts`
- `packages/backend/src/services/db.ts`
- `packages/backend/src/services/digest.ts`
- `docs/MEMORY_ARCHITECTURE.md`
- `docs/session-maintenance.md`

Current state:

- Claude SDK sessions are used for resume and compaction behavior.
- `session-maintenance.md` documents Claude `.jsonl` session accumulation.
- The Scribe digest agent now routes through the provider-neutral text query helper with configurable provider/model, interval, digest path, and minimum-message threshold.
- Provider-neutral thread history exists in SQLite, but non-Claude providers do not yet get a full Resonant-owned continuity reconstruction layer.

Normalization target:

Create a Resonant-owned session/context assembler:

```text
packages/backend/src/continuity/
  thread-context.ts
  digest-context.ts
  semantic-context.ts
  compaction.ts
  handoff.ts
```

Provider rules:

- Claude Code may keep native resume as an optimization.
- Codex/OpenRouter should build context from Resonant DB, digests, and semantic search.
- Scribe/digest uses a provider adapter through `runtime/text-query.ts`.

### Autonomous Wakes And Background Agents

Current files:

- `packages/backend/src/services/orchestrator.ts`
- `packages/backend/src/services/digest.ts`

Current state:

- Orchestrator calls `AgentService`, which is good.
- Orchestrator imports `fetchLifeStatus` from `hooks.ts`, which ties it to the hook module shape.
- Digest bypasses `AgentService` for simplicity but calls the provider-neutral text query helper rather than the Claude SDK directly.

Normalization target:

- Move life/status context helpers out of `hooks.ts`.
- Keep all model calls, including Scribe/digest, routed through a runtime provider contract.
- Allow autonomous model/provider selection separately from interactive selection.
- Add capability checks for background jobs that require tool use versus text-only summarization.

### Model And Provider Configuration

Current files:

- `packages/backend/src/config.ts`
- `packages/backend/src/routes/api.ts`
- `packages/frontend/src/lib/components/ModelSelector.svelte`
- `packages/frontend/src/lib/components/PreferencesPanel.svelte`
- `packages/backend/src/services/commands.ts`

Current state:

- Interactive and autonomous providers are explicit config fields.
- `ModelSelector.svelte` includes provider-aware Claude and GPT entries.
- Settings exposes runtime/model selection, Codex permission mode, OpenRouter config/key management, identity, Scribe, Push/VAPID, Discord, and Telegram.
- Provider/model catalogs are still partly hardcoded and should move toward backend-driven capability metadata.
- `/model` accepts provider/model updates but still needs stronger provider capability validation.

Normalization target:

Add explicit provider config:

```yaml
agent:
  provider: "claude-code"
  model: "claude-sonnet-4-6"
  autonomous_provider: "claude-code"
  model_autonomous: "claude-sonnet-4-6"

providers:
  claude_code:
    enabled: true
  openai_codex:
    enabled: false
    permission: "workspace-write"
  openrouter:
    enabled: false
    api_key_env: "OPENROUTER_API_KEY"
    base_url: "https://openrouter.ai/api/v1"
```

Frontend should render provider cards with capability badges:

- subscription/login
- API key
- tools
- MCP
- rewind
- thinking
- autonomous-ready

### Permissions And Safety

Current files:

- `packages/backend/src/services/hooks.ts`
- `packages/backend/src/services/agent.ts`

Current state:

- Claude path runs with `permissionMode: 'bypassPermissions'` and hook-level destructive Bash checks.
- Codex path supports `read-only`, `workspace-write`, and `danger-full-access`.
- Resonant internal tools currently depend on shell permissions unless accessed directly through API.

Normalization target:

Permissions should attach to tool execution, not to a provider's shell behavior.

Needed layers:

- provider runtime permission mode
- Resonant tool permission level
- per-tool allow/deny policy
- explicit dangerous-action confirmation points
- audit log for all tool executions, regardless of provider

### Streaming, UI Events, And Capability Flags

Current files:

- `packages/shared/src/protocol.ts`
- `packages/shared/src/types.ts`
- `packages/backend/src/services/agent.ts`
- `packages/backend/src/services/ws.ts`
- frontend message/tool components

Current state:

- UI protocol already has useful neutral events: stream start/token/end, tool use/result/progress, thinking, context usage, rate limit, compaction, MCP status, rewind result.
- Events are emitted mostly from Claude stream parsing and Claude hooks.
- Codex path streams text but does not emit tool cards.

Normalization target:

Make provider adapters emit normalized runtime events:

- `text_delta`
- `thinking_delta`
- `tool_use`
- `tool_result`
- `tool_progress`
- `context_usage`
- `compaction`
- `rate_limit`
- `session`
- `error`
- `done`

Then `AgentService` translates those into the existing WebSocket protocol.

### Voice, Files, Canvas, Reactions, Search, Timers, Triggers

Current state:

These are already mostly Resonant-owned features. The problem is access path, not domain logic:

- UI can call many of these directly.
- Companion access is often mediated through `sc.mjs` and Bash.
- Tool result visualization is Claude-hook-dependent.

Normalization target:

Expose each capability as a first-class internal tool. Keep the existing REST endpoints and CLI as compatibility surfaces.

### Documentation, Setup, And Product Language

Current files:

- `README.md`
- `docs/GETTING-STARTED.md`
- `docs/CLOUD-DEPLOYMENT.md`
- `docs/HOOKS.md`
- `docs/TOOLS.md`
- `docs/MEMORY_ARCHITECTURE.md`
- `scripts/setup.mjs`
- `examples/.env.example`
- `package.json`

Current state:

- Public docs now frame Resonant as provider-pluggable with Claude Code as the default full-featured runtime.
- Setup creates provider-neutral identity scaffolding and current v2.2.0 config keys.
- Remote access docs now treat Tailscale as the private companion baseline and Cloudflare Tunnel as an optional HTTPS/public-domain layer.
- Cloud deployment docs now separate Tailscale private/admin access from optional Cloudflare Tunnel.
- `docs/HOOKS.md` now distinguishes provider-neutral context construction from provider-specific hook adapters.

Normalization target:

Docs should use this language:

- "Claude Code is the default full-featured runtime."
- "Resonant is moving to provider-pluggable runtimes."
- "Capabilities vary by runtime and are labeled in the UI."
- "Subscription-backed runtimes and API-key runtimes are separate modes."

Do not claim equal support before the capability matrix is real.

## Proposed Internal Interfaces

### Runtime Provider

```ts
export type RuntimeProviderId =
  | 'claude-code'
  | 'openai-codex'
  | 'openrouter'
  | 'openai-api'
  | 'openai-compatible'
  | 'ollama';

export interface RuntimeCapabilities {
  subscriptionAuth: boolean;
  apiKeyAuth: boolean;
  sessions: boolean;
  resonantTools: boolean;
  externalMcp: boolean;
  mcpManagement: boolean;
  localSkills: 'native' | 'prompt' | 'unsupported';
  shell: boolean;
  fileCheckpointing: boolean;
  rewind: boolean;
  compactionEvents: boolean;
  thinkingStream: boolean;
  tokenUsage: boolean;
  autonomous: boolean;
}

export interface RuntimeQuery {
  threadId: string;
  prompt: string;
  systemPrompt: string;
  model: string;
  cwd: string;
  sessionId?: string | null;
  isAutonomous: boolean;
  platform: 'web' | 'discord' | 'telegram' | 'api';
  abortSignal: AbortSignal;
  tools: RuntimeToolDefinition[];
  context: RuntimeContext;
}

export interface AgentRuntimeProvider {
  id: RuntimeProviderId;
  label: string;
  capabilities: RuntimeCapabilities;
  run(query: RuntimeQuery): AsyncIterable<RuntimeEvent>;
  listSessions?(limit?: number): Promise<unknown[]>;
  getExternalMcpStatus?(): Promise<unknown[]>;
  reconnectExternalMcp?(name: string): Promise<{ success: boolean; error?: string }>;
  rewindFiles?(userMessageId: string, dryRun?: boolean): Promise<unknown>;
}
```

### Runtime Events

```ts
export type RuntimeEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; text: string; summary?: string }
  | { type: 'tool_use'; toolId: string; toolName: string; input: unknown }
  | { type: 'tool_result'; toolId: string; output: unknown; isError?: boolean }
  | { type: 'tool_progress'; toolId: string; elapsed: number }
  | { type: 'context_usage'; tokensUsed: number; contextWindow?: number }
  | { type: 'compaction'; preTokens?: number; complete: boolean }
  | { type: 'rate_limit'; status: string; resetsAt?: number }
  | { type: 'session'; sessionId: string }
  | { type: 'error'; message: string; recoverable?: boolean }
  | { type: 'done' };
```

### Tool Definition

```ts
export interface RuntimeToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  permission: 'read' | 'write' | 'destructive' | 'external';
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}
```

## Build Order

### Phase 0: Stabilize Current Test Harness

- Keep Avery profile and separate config as the sacrificial provider test instance.
- Keep Claude Code as default.
- Keep current Codex test path, but mark it experimental.

### Phase 1: Extract Context From Hooks

- Move orientation/context helpers out of `hooks.ts`.
- Replace `fetchLifeStatus` imports from `hooks.ts`.
- Keep Claude hook behavior unchanged.

Success:

- Claude path behaves the same.
- Orchestrator imports context helpers from a neutral module.
- Unit tests still pass.

### Phase 2: Extract Tool Registry

- Create internal tool definitions for current `sc.mjs` capabilities.
- Make `sc.mjs` call the registry/API as a client.
- Make Claude hook tool cards use registry metadata.
- Make Codex use backend-executed tools instead of shell-dependent `node tools/sc.mjs`.

Success:

- Timer/list/search/reaction/canvas tools work under Claude and Codex without relying on shell permission.
- Tool cards appear for provider-neutral tool execution.

### Phase 3: Extract Runtime Provider Interface

- Move Claude SDK imports into `claude-code-provider.ts`.
- Move Codex CLI logic into `openai-codex-provider.ts`.
- Make `AgentService` consume normalized `RuntimeEvent`.
- Add capability metadata.

Success:

- Same UI behavior for Claude.
- Codex path no longer lives inside `AgentService`.
- Unsupported features show as unsupported rather than broken.

### Phase 4: Normalize Model/Provider Settings

- Add explicit `agent.provider` and `agent.autonomous_provider`.
- Replace hardcoded frontend model lists with backend-provided provider/model catalog.
- Update `/model` command to understand provider-qualified models.

Success:

- Claude, Codex, and future OpenRouter options are visibly different runtimes.
- Preferences panel no longer says everything is a Claude model.

### Phase 5: Move Scribe/Digest To Runtime Providers

- Replace direct Claude SDK import in `digest.ts`.
- Use a text-only runtime query with capability checks.
- Allow separate scribe provider/model configuration.

Success:

- Background digest can run on Claude, Codex, or API provider.
- No hidden Anthropic-only model call remains.

### Phase 6: OpenRouter BYOK

- Add OpenRouter provider adapter.
- Support streaming text first.
- Add provider-native tool calling where supported.
- Fall back to structured JSON tool-call loop where needed.

Success:

- OpenRouter models can run the same identity, orientation, tools, and chat surface with honest capability labels.

## Minimum Honest Capability Matrix

| Capability | Claude Code | OpenAI Codex | OpenRouter |
|---|---:|---:|---:|
| Subscription/login auth | yes | yes | no |
| API key auth | no | no | yes |
| Identity renderer | yes | yes | yes |
| Orientation context | yes | yes | yes |
| Streaming text | yes | experimental | no, planned |
| Resonant internal tools | CLI/hook compatibility plus partial registry | partial registry tool loop | no, planned |
| Tool UI cards | yes today | partial for registry tools | no, planned |
| External MCP | yes native | later | later |
| MCP management UI | yes native | later/unsupported | later/unsupported |
| Skills | native `.claude` | prompt/export | prompt |
| Slash commands | Claude-native plus Resonant | Resonant only | Resonant only |
| Rewind/checkpointing | yes native | provider-dependent | no |
| Compaction events | yes native | provider-dependent/emulated | emulated |
| Scribe/digest | yes through runtime text query | experimental through runtime text query | blocked until adapter |
| Provider settings UI | yes | yes | config/key management only |

## Main Risks

- Lowest-common-denominator design would weaken Resonant. Capability labels are better than flattening.
- "Hooks" is currently overloaded. Rename the product concept to lifecycle/context and keep Claude hooks as one adapter.
- Tool permission must become Resonant-owned. Provider shell permissions are not a stable product boundary.
- Claude Code session memory is useful but not portable. Resonant needs its own continuity assembly.
- The docs currently overstate backend agnosticism in places. Update language only as features become real.

## Recommended Next Implementation Slice

The first extraction pass is complete: `runtime-lifecycle/context-builder.ts` exists, `AgentService` uses it, orchestrator imports neutral `fetchLifeStatus`, and context-builder tests pass.

The next implementation slice should finish the cleanup that this first pass intentionally left behind:

1. Replace duplicated context functions in `services/hooks.ts` with imports from `runtime-lifecycle/context-builder.ts`.
2. Move Claude hook-specific code into a clearly named Claude adapter module, e.g. `runtime-lifecycle/claude-hooks-adapter.ts`.
3. Extract tool display names, audit writes, destructive-command checks, and file auto-share handling into provider-neutral lifecycle/tool helpers.
4. Keep Claude hook behavior unchanged while shrinking `services/hooks.ts`.
5. Add regression tests proving Claude hooks still inject the same orientation and emit the same tool/audit side effects.

After that, continue with the internal tool registry expansion before implementing real OpenRouter execution.
