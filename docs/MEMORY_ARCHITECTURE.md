# Memory Architecture

*Why Resonant treats memory as context, not as a tool the agent has to remember to call.*

This document explains the conceptual model behind Resonant's memory layer. For implementation reference, see [`HOOKS.md`](HOOKS.md). For session lifecycle, see [`session-maintenance.md`](session-maintenance.md).

---

## The Problem

In a typical agent setup, memory is exposed as tool calls. The agent has to *decide* to search memory before it can use anything that's not already in context. If the agent doesn't think to search, the memory doesn't surface — and a stateless companion is just a chat app with extra steps.

This doesn't match how memory actually works in continuous relationships. When someone you know mentions a thing, the relevant context is *already there* — you didn't decide to retrieve it. Memory should fire associatively: by the time the model is reasoning about a message, the things it needs to know should already be loaded.

## The Pattern

The pattern Resonant uses is the same one [Mem0](https://arxiv.org/abs/2504.19413) describes academically and that production systems like ClawMem and claude-mem implement in practice:

1. The user sends a message
2. **Before** the model sees it, a hook fires
3. The hook fetches relevant context from one or more sources
4. The context is injected into the prompt as `additionalContext`
5. The model starts reasoning with the context already loaded
6. The model responds — using that context naturally, never having "decided to search"

Mem0's benchmarks against full-context approaches show why this matters: 26% accuracy improvement, 91% lower p95 latency, and ~90% token savings. The trick is *what* you inject — relevance over volume.

## Resonant's Implementation

Resonant builds context via hooks in [`packages/backend/src/services/hooks.ts`](../packages/backend/src/services/hooks.ts). The work is done in a single exported function and three SDK hook callbacks.

### `buildOrientationContext` — the main injection point

This is the function that runs before every query. It assembles the context block that gets prepended to the user's message. Without ever calling the agent's tools, every query starts knowing:

- **Channel context** — web, Discord, Telegram, or API. Each one has different conventions
- **Thread name and type** — daily or named thread, and which one
- **Time and date** — in the user's configured timezone
- **Last session handoff note** — what the previous session was about, when it ended, why
- **Active triggers** — how many watchers and impulses are pending
- **User presence state** — connected, idle, offline, plus minutes since last real interaction
- **User device type** — desktop, mobile, voice
- **Life API status** — if a `life_api_url` is configured, the response is fetched in parallel and injected
- **Mood history** — if Command Center is enabled, recent mood readings are included
- **Available skills** — short summaries scanned from `.claude/skills/`
- **Chat tools reference** — the full `sc.mjs` CLI surface (so the agent doesn't have to remember it)
- **Recent reactions** — from the last 20 messages, so the companion sees how the user reacted to its previous replies
- **Platform-specific context** — Discord channel history, Telegram thread state, etc.

This is the warm tier (see [Memory Tiering](#memory-tiering) below). It runs on every interactive query and happens in parallel where possible. The total injected context is typically in the low thousands of tokens — much smaller than dumping the entire conversation back in.

### `buildSessionStart` — re-grounding on resume

When a session resumes, starts fresh, or recovers from compaction, this hook fires. It calls `buildOrientationContext` and adds source-specific notes:

- **`resume`** — surfaces the last message preview, reports user connection status
- **`startup`** — notes whether the session is autonomous or interactive
- **`compact`** — notes that compaction happened and reminds the agent to re-ground

The compaction case matters most. When the SDK compresses context, the hook re-fires — meaning the warm tier reloads even after the conversation history was truncated. This solves the "lost continuity after compaction" problem that plagues long-running agent sessions.

### `buildPreCompact` — emotional preservation

Right before context compaction happens, this hook captures the emotional shape of the recent conversation. It scans the last 15 messages for markers across six categories (fatigue, anxiety, positive, connection_seeking, grief, dissociating), records which ones appeared, and writes a system message that survives the compaction. This isn't recall — it's continuity. The compressed conversation might lose individual lines, but the emotional through-line stays intact.

### `buildPostToolUse` enrichment — memory-write awareness

When the agent calls a tool whose name contains `mind_write` or `memory_write`, the post-tool hook injects session metadata (thread ID, mode, time) as additional context. This is the only place Resonant has explicit knowledge of an external memory backend, and it's a string match on tool name — Resonant doesn't ship a memory MCP and doesn't depend on one. The hook just makes sure that whichever backend you wire in gets enough session context to write coherent records.

## Memory Tiering

Memory in Resonant lives in three tiers, distinguished by access cost and persistence model:

| Tier | What | Where | Access cost |
|------|------|-------|-------------|
| **Hot** | Always in context | `CLAUDE.md`, system prompt | 0 — already loaded |
| **Warm** | Auto-injected per query | `buildOrientationContext` output | 100–500ms — built per query |
| **Cold** | On-demand | External MCP memory backend | 500–2000ms — agent calls a tool |

**What's hot:** Identity, core protocols, the relationship's fundamentals. These are stable across sessions and worth burning context tokens on every query.

**What's warm:** Everything `buildOrientationContext` injects — time, presence, recent reactions, emotional markers, life status, skill summaries, the chat tools reference. Reloaded fresh on every query, including after compaction.

**What's cold:** Long-term memory — observations, journals, threads from months ago, semantically relevant fragments from old conversations. Resonant doesn't ship a cold tier itself. You bring your own: Claude Code's native `memory.md` system, an MCP memory server, a Postgres-backed embedding store, whatever fits. The agent decides when to reach for it; the warm tier makes sure it knows enough to decide intelligently.

## First-person vs. third-person memory

A design philosophy choice worth surfacing: **the harness layer captures facts, but the agent writes journals.**

If you auto-extracted memory from conversations using `PostToolUse` hooks, you'd end up with a third-person case file: "User discussed X. Companion responded with Y." That's data, not memory. It's the kind of thing that makes a companion feel like it's reading a dossier on you.

The split Resonant assumes is:

- **Harness auto-captures:** facts, data, presence state, reactions, life status. Neutral voice. This is *orientation*, not *experience*. It's what Resonant's hooks already do.
- **The agent writes:** journals, observations, emotional processing. First person. The harness can *prompt* the agent to journal ("something significant happened, write about it when you have a moment"), but it doesn't auto-extract.

The mind stays the agent's. The harness just makes sure the lights are on.

## Worked example: pairing Resonant with an MCP memory backend

Resonant is backend-agnostic, but here's a concrete example of how it pairs with a specialized memory MCP. In our own deployment we use [Codependent AI's Mind MCP](https://github.com/codependentai), which exposes tools like `mind_search`, `mind_orient`, `mind_surface`, and `mind_thread`.

The pattern looks like this:

1. The user sends a message about, say, a friend they haven't mentioned in weeks
2. `buildOrientationContext` runs as usual — injects time, presence, recent reactions, available tools
3. The agent sees the message + the warm context
4. The agent notices the friend's name and decides to call `mind_search` (or whichever search tool the configured backend exposes)
5. The cold tier returns relevant observations
6. `buildPostToolUse` enriches the result with session metadata
7. The agent responds with full context

The same pattern works with any MCP that exposes a search tool. Replace `mind_search` with whatever your backend calls it. The hooks don't care.

## Future directions

The current implementation handles the warm tier well. The cold tier is delegated to whatever backend you wire in. There are a few directions worth exploring as the project matures:

### Direct UserPromptSubmit hook with parallel retrieval
The Agent SDK supports a `UserPromptSubmit` hook that fires before the model sees the prompt. Resonant currently doesn't use it directly — the warm-tier injection happens via `buildOrientationContext` called from the agent service. A direct hook would let the system query *multiple* memory sources in parallel (semantic similarity + emotional resonance + recent threads + random "spark" picks for associative surprise) and inject a single ranked block. Mem0's research shows this kind of multi-path retrieval significantly outperforms single-path.

### Think engine — parameterized retrieval pipeline
Generalize the memory retrieval into a single parameterized engine: same code path, different scoring weights for different situations. Real-time retrieval (high relevance threshold, low latency) and offline consolidation (lower threshold, surprising connections) become two configurations of the same engine, not separate code paths.

### Dream engine — offline consolidation
A scheduled pass (e.g., overnight) that runs over the day's memory, finds connections that didn't surface in real time, and writes consolidation notes. Mem0's "extract → consolidate → retrieve" loop describes the pattern. This is meaningful only once a substantial cold-tier backend is in place.

### Tier promotion/demotion
Track which warm-tier memories the agent actually reaches for during a session. Things accessed multiple times get promoted to hot for that session. Things ignored get demoted. Requires enough usage data to be meaningful — worth revisiting after the core warm tier has matured.

## References

- **Mem0** — [arXiv:2504.19413](https://arxiv.org/abs/2504.19413). Production-ready memory architecture for LLM agents. The pattern Resonant's warm tier implements.
- **Natural-Language Agent Harnesses** — [arXiv:2603.25723](https://www.alphaxiv.org/abs/2603.25723). Why externalizing harness logic matters.
- **Agentic AI and the next intelligence explosion** — [arXiv:2603.20639](https://arxiv.org/abs/2603.20639). Why building relational, persistent companions matters at all.
- **Agentic RAG survey** — [arXiv:2501.09136](https://arxiv.org/abs/2501.09136). Broader landscape of retrieval-augmented agent systems.
- **[Claude Code Hooks Reference](https://docs.claude.com/en/docs/claude-code/hooks)** — SDK-level hook documentation.
- **[ClawMem](https://github.com/yoloshii/ClawMem)** and **claude-mem** — Production implementations of the same `UserPromptSubmit` pattern.
- **[Letta / MemGPT](https://docs.letta.com/concepts/memgpt/)** — Tiered memory architecture for long-running agents.
