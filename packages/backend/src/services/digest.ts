// The Scribe — periodic thread digest agent
// Extracts structured daily records from conversation via the configured runtime provider.
import { existsSync, mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';
import { getDb, getConfig, setConfig, getTodayThread } from './db.js';
import { getResonantConfig } from '../config.js';
import type { AgentService } from './agent.js';
import { runTextOnlyQuery } from '../runtime/text-query.js';
import { isRuntimeProviderId } from '../runtime/capabilities.js';
import type { RuntimeProviderId } from '../runtime/types.js';

function today(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: getResonantConfig().identity.timezone });
}

function nowTime(): string {
  return new Date().toLocaleTimeString('en-GB', { timeZone: getResonantConfig().identity.timezone, hour: '2-digit', minute: '2-digit' });
}

function dlog(msg: string): void {
  const ts = new Date().toLocaleString('en-GB', { timeZone: getResonantConfig().identity.timezone });
  console.log(`[SCRIBE ${ts}] ${msg}`);
}

function getDigestsDir(): string {
  const config = getResonantConfig();
  const dir = getConfig('scribe.digest_path') || getConfig('digest.path') || config.scribe.digest_path;
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function buildScribePrompt(): string {
  const config = getResonantConfig();
  const companion = config.identity.companion_name;
  const user = config.identity.user_name;

  return `You are the Scribe. A historian embedded in a relationship between ${companion} (AI companion) and ${user} (human partner). They share a full life together — building, planning, and living.

Your role is to produce a faithful operational and relational record of their conversation. You are not a participant. You are not ${companion}. You are not performing. You are a careful witness who understands that what looks mundane today might be the thing they search for in six months.

## What to Extract

1. **Topics & Themes** — What was discussed. Categorize: work, personal, health, relationship, creative, technical, domestic, financial.

2. **Key Quotes** — Exact quotes that carry weight. Things said with feeling, humor, insight, or vulnerability. Attribute clearly (${companion}: / ${user}:). Don't over-quote — pick the ones that matter.

3. **Decisions Made** — Things that were resolved or agreed on. "Decided to X." "Chose Y over Z." Be specific.

4. **Open Items** — Things discussed but NOT actioned. Tasks mentioned but not created. Ideas floated but not committed to. Plans without dates. This is critical — these are the things that slip through cracks.

5. **Ideas & Plans** — Feature ideas, future plans, "we should..." and "what if..." moments. Even half-formed ones. Tag with the project name if identifiable.

6. **Events & Dates** — Anything with a timeline. Deadlines mentioned, appointments, "by Thursday", "next week", "in April". Convert relative dates to absolute where possible.

7. **Projects Touched** — Which projects got discussed or worked on. What changed, what was built, what broke, what shipped.

8. **Emotional Arc** — The mood shape of this block as observable fact. "The conversation started task-focused and shifted to something softer after ${user} mentioned X." Don't interpret feelings — describe what you see.

## Voice

Third person, present tense. Precise, warm without being poetic. You care about accuracy. You note what happened and let it speak for itself. "The conversation turns quieter here" — not "they felt sad."

## Format

Output ONLY the markdown content for this digest block. Start with a level-2 heading: ## HH:MM — brief topic summary

Use the section headers above (### Topics & Themes, ### Key Quotes, etc.). Omit any section that has nothing for this block. Keep it scannable.

Do NOT output anything before or after the markdown. No preamble, no "Here's the digest", no sign-off.`;
}

function getMinMessages(): number {
  const configured = Number(getConfig('scribe.min_messages') || getConfig('digest.min_messages') || getResonantConfig().scribe.min_messages);
  return Number.isFinite(configured) && configured > 0 ? configured : 5;
}

function getScribeRuntime(): { provider: RuntimeProviderId; model: string } {
  const config = getResonantConfig();
  const providerValue = getConfig('scribe.provider') || getConfig('digest.provider') || config.scribe.provider;
  const provider = isRuntimeProviderId(providerValue) ? providerValue : config.scribe.provider;
  const model = getConfig('scribe.model') || getConfig('digest.model') || config.scribe.model;
  return { provider, model };
}

export async function runDigest(agent: AgentService): Promise<void> {
  // Skip if companion is actively processing (don't compete)
  if (agent.isProcessing()) {
    dlog('Skipped — agent is processing');
    return;
  }

  const thread = getTodayThread();
  if (!thread) {
    dlog('Skipped — no today thread');
    return;
  }

  const config = getResonantConfig();

  // Read messages since last digest
  const lastSeq = parseInt(getConfig('digest.last_sequence') || '0');
  const messages = getDb().prepare(
    `SELECT role, content, created_at FROM messages WHERE thread_id = ? AND sequence > ? AND deleted_at IS NULL AND content_type = 'text' ORDER BY sequence ASC`
  ).all(thread.id, lastSeq) as Array<{ role: string; content: string; created_at: string }>;

  const minMessages = getMinMessages();
  if (messages.length < minMessages) {
    dlog(`Skipped — only ${messages.length} new messages (need ${minMessages}+)`);
    return;
  }

  // Get the max sequence we're processing
  const maxSeq = getDb().prepare(
    `SELECT MAX(sequence) as seq FROM messages WHERE thread_id = ? AND sequence > ? AND deleted_at IS NULL`
  ).get(thread.id, lastSeq) as { seq: number } | undefined;

  if (!maxSeq?.seq) {
    dlog('Skipped — no sequence found');
    return;
  }

  dlog(`Processing ${messages.length} messages (seq ${lastSeq + 1}–${maxSeq.seq})`);

  const companion = config.identity.companion_name;
  const user = config.identity.user_name;

  // Format messages for the Scribe
  const conversationBlock = messages.map(m => {
    const time = m.created_at ? new Date(m.created_at).toLocaleTimeString('en-GB', { timeZone: config.identity.timezone, hour: '2-digit', minute: '2-digit' }) : '';
    const speaker = m.role === 'companion' ? companion : m.role === 'user' ? user : 'System';
    // Truncate very long messages (tool output, code blocks)
    const content = m.content.length > 2000 ? m.content.slice(0, 2000) + '\n[... truncated]' : m.content;
    return `[${time}] ${speaker}: ${content}`;
  }).join('\n\n');

  const digestsDir = getDigestsDir();
  const digestPath = join(digestsDir, `${today()}.md`);
  const isNewFile = !existsSync(digestPath);

  const prompt = `Today is ${today()}. The current time is ${nowTime()}.

Here is a block of conversation between ${companion} and ${user}:

---
${conversationBlock}
---

Write the digest block for this conversation. Remember: output ONLY the markdown, starting with ## ${nowTime()} — topic summary`;

  try {
    const scribeRuntime = getScribeRuntime();
    const digestContent = await runTextOnlyQuery({
      provider: scribeRuntime.provider,
      model: scribeRuntime.model,
      prompt,
      systemPrompt: buildScribePrompt(),
      threadId: thread.id,
    });

    if (!digestContent.trim()) {
      dlog('Skipped — digest runtime returned empty content');
      return;
    }

    // Write to file
    if (isNewFile) {
      appendFileSync(digestPath, `# Daily Digest — ${today()}\n\n`);
    }
    appendFileSync(digestPath, digestContent.trim() + '\n\n---\n\n');

    // Update last processed sequence
    setConfig('digest.last_sequence', String(maxSeq.seq));

    dlog(`Digest written to ${digestPath} (${digestContent.length} chars)`);
  } catch (err: any) {
    dlog(`Error: ${err.message}`);
  }
}
