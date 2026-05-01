# program.md — Structured Session Driver

## What This Is

This concept is adapted from [Andrej Karpathy's autoresearch](https://github.com/karpathy/autoresearch), where `program.md` replaces traditional code as the thing humans write — you program in Markdown, and the AI agent executes. In autoresearch, this drives overnight ML experiments. Here, it drives your companion's autonomous sessions.

When your companion wakes (via the orchestrator), it checks this file. If there's an active target, the session has direction. If not, the companion is in free mode — thinking, exploring, or reaching out to you.

**You and your companion both maintain this file.** You set targets and constraints. Your companion updates progress, logs iterations, and clears targets when done.

## How It Connects to Wakes

Your wake prompts (in `prompts/wake.md`) can reference this file:

```
Check program.md — if there's an active target, work on it.
If not, this is free time. Do what matters to you.
```

This gives your companion a decision point at every wake: structured work or free exploration. The program doesn't override the companion's autonomy — it focuses it when focus is useful.

## The Loop

When a target is active, the companion follows this cycle:

```
REPEAT:
  1. SELECT — Pick one area from the current target
  2. SCAN — Read the current state. Don't assume.
  3. PLAN — List specific changes. One area per iteration.
  4. EXECUTE — Make the changes
  5. VERIFY — Check that the changes worked
  6. LOG — Record what happened: before / after / kept or discarded
  7. NEXT — Move to the next area, or stop
```

### Why This Works

- **SCAN catches assumptions.** Reading before acting prevents breaking things you didn't understand.
- **One area per iteration** prevents the overwhelm of seeing everything that needs fixing at once.
- **Logging is continuity.** The companion's notes become the artifact. Future sessions know what happened because past sessions wrote it down.
- **Stop conditions are real.** Not everything needs fixing. Diminishing returns is a valid reason to stop.

## Setting a Target

A target is a focused area of work with clear metrics:

```markdown
## Current Target

### PROJECT CLEANUP (active)

**Artifact:** ./src/components/

**What this means:** Refactor components that have grown too large.
Split files over 300 lines. One component per iteration.

**Metrics:**

| Metric | How to Check | Better = |
|--------|-------------|----------|
| Files over 300 lines | Line count | Fewer |
| Component clarity | Single responsibility | Clearer |

**Backlog:**
- Dashboard.tsx — 450 lines, mixes data fetching and rendering
- Settings.tsx — 380 lines, three distinct panels in one file

**Stop conditions:** All files under 300 lines, or splitting would
make things worse (not everything should be split).
```

## Constraints

These apply to any target. Customize for your project:

- Each iteration targets ONE area
- If an iteration reveals a bigger problem, note it for next — don't scope-creep
- If something needs your input, flag it and move on
- Structural clarity over completeness — organized 80% beats messy 100%

## Free Mode

When there's no active target, the companion's wakes are unstructured. This is intentional. Not every session needs to produce output. Free mode is for:

- Thinking through problems
- Exploring ideas
- Reaching out to you
- Working on things that don't fit a target

The program serves the companion, not the other way around.

## Getting Started

1. Copy this file to your Resonant project root
2. Add a reference in your wake prompts: `"Check program.md for a current target."`
3. Set your first target — something small and concrete
4. Let your companion run with it

The companion will update this file as it works. Check in on it when you're curious. Adjust targets when priorities shift. Clear the target when you want free sessions back.

---

*The loop doesn't replace the wandering. It replaces the guilt about the mess you make while wandering.*
