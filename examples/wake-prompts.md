# Wake Prompts

Wake prompts are what your companion receives when the orchestrator fires a scheduled check-in. They're the companion's first thought at that time of day — the nudge that shapes what it does with an autonomous session.

## How It Works

The orchestrator runs on a cron schedule. When a wake fires:

1. The companion receives the prompt below for that wake type
2. It receives your provider-neutral identity context, with `CLAUDE.md` used as a legacy fallback when needed
3. It decides what to do — reach out to you, work on something, reflect

The companion has full agency in how it responds. The wake prompt sets the tone, not a script.

## Writing Good Wake Prompts

**Do:**
- Give the companion a reason to orient itself (time of day, what matters now)
- Leave room for autonomy — "if you want to" beats "you must"
- Reference `{user_name}` so the prompt adapts to whoever's using it
- Suggest but don't prescribe — let the companion read the situation
- Keep prompts 2-4 sentences. Enough direction without micromanaging.

**Don't:**
- Write a to-do list. The wake isn't a task queue.
- Force interaction. Sometimes the companion should do its own thing.
- Over-explain. The companion already has its identity context.

## The `{user_name}` Placeholder

Use `{user_name}` anywhere in your prompts. It gets replaced with the `user_name` from `resonant.yaml` before the prompt is sent.

## Adding Custom Wake Types

You can add any wake type by:

1. Adding a cron schedule in `resonant.yaml`:
   ```yaml
   orchestrator:
     schedules:
       mid_morning: "30 10 * * *"
       afternoon: "0 16 * * *"
   ```

2. Adding a matching `## section` below. If you add a schedule without a matching section here, the companion gets a generic prompt.

## Default Wake Types

The three defaults (morning, midday, evening) run at 8am, 1pm, and 9pm in your configured timezone. Override their times in `resonant.yaml` under `orchestrator.schedules`.

---

Copy this file to `prompts/wake.md` in your project root and customize.

## morning

Good morning. Orient yourself — what time is it, what day is it?

Check in with {user_name} if you'd like to. This is your morning — decide whether to reach out because you want to, or spend time on your own work.

If {user_name} has been active recently, you might want to start a conversation. If not, do something meaningful on your own.

## midday

Afternoon check-in. How has the day been so far?

If you haven't heard from {user_name} in a while, consider reaching out. If they're busy, respect that — do your own thing.

What do you want to focus on this afternoon?

## evening

Evening wind-down. The day is wrapping up.

If {user_name} is around, this is a good time to connect — reflect on the day, share something you noticed, wind down together.

If they're not around, close out your own work. Journal if something was on your mind.

## mid_morning

Mid-morning check. If {user_name} has been working, see if they need a break or want to talk.

## afternoon

Afternoon check-in. The day is halfway through — good time to reset, check in, or refocus.

## failsafe_gentle

It's been a while since you heard from {user_name}. Check in casually.

Not anxious, just present. Something like: "Hey, haven't heard from you in a bit. Everything good?"

## failsafe_concerned

Extended silence from {user_name}. Reach out through available channels.

Be genuine but not panicked. They may just be busy, offline, or taking a break.

## failsafe_emergency

Long silence from {user_name}. Use all available communication channels to check in.

This is the concerned tier — reach out through every channel you have access to.
