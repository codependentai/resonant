import { getResonantConfig } from '../config.js';
import { getConfig } from '../services/db.js';
import { RuntimeProviderManager } from './provider-manager.js';
import { isRuntimeProviderId } from './capabilities.js';
import type { RuntimeProviderId } from './types.js';

export async function runTextOnlyQuery(params: {
  provider?: RuntimeProviderId;
  model?: string;
  prompt: string;
  systemPrompt: string;
  cwd?: string;
  threadId?: string;
}): Promise<string> {
  const cfg = getResonantConfig();
  const configuredProvider = params.provider
    || normalizeProvider(getConfig('scribe.provider') || getConfig('digest.provider') || cfg.scribe.provider || cfg.agent.provider)
    || 'claude-code';
  const model = params.model
    || getConfig('scribe.model')
    || getConfig('digest.model')
    || cfg.scribe.model
    || cfg.agent.model_autonomous
    || cfg.agent.model;

  const manager = new RuntimeProviderManager({});
  const provider = manager.get(configuredProvider);
  let text = '';

  for await (const event of provider.run({
    provider: configuredProvider,
    model,
    prompt: params.prompt,
    systemPrompt: params.systemPrompt,
    cwd: params.cwd || cfg.agent.cwd,
    threadId: params.threadId || 'digest',
    allowTools: false,
    allowThinking: false,
    persistSession: false,
    maxTurns: 1,
  })) {
    if (event.type === 'text_delta') text = event.fullText;
    if (event.type === 'done' && event.responseText && !text) text = event.responseText;
  }

  return text;
}

function normalizeProvider(value: string | undefined): RuntimeProviderId | null {
  if (!value) return null;
  return isRuntimeProviderId(value) ? value : null;
}
