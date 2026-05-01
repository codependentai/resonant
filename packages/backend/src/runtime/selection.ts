import type { ResonantConfig } from '../config.js';
import { getConfig } from '../services/db.js';
import { isRuntimeProviderId } from './capabilities.js';
import type { RuntimeProviderId, RuntimeSelection } from './types.js';

function inferProviderFromModel(model: string): RuntimeProviderId {
  if (model.startsWith('openai-codex:')) return 'openai-codex';
  if (model.startsWith('openrouter:')) return 'openrouter';
  if (model.startsWith('claude-code:')) return 'claude-code';
  if (/^gpt-\d/i.test(model) || /^o\d/i.test(model)) return 'openai-codex';
  return 'claude-code';
}

function stripProviderPrefix(model: string): string {
  return model
    .replace(/^openai-codex:/, '')
    .replace(/^openrouter:/, '')
    .replace(/^claude-code:/, '');
}

function normalizeProvider(value: string | undefined, model: string): RuntimeProviderId {
  if (value && isRuntimeProviderId(value)) return value;
  return inferProviderFromModel(model);
}

export function resolveRuntimeSelection(isAutonomous: boolean, cfg: ResonantConfig): RuntimeSelection {
  const model = (
    isAutonomous
      ? (getConfig('agent.model_autonomous') || cfg.agent.model_autonomous)
      : (getConfig('agent.model') || cfg.agent.model || process.env.AGENT_MODEL || 'claude-sonnet-4-6')
  ).trim();

  const dbProvider = isAutonomous
    ? getConfig('agent.autonomous_provider')
    : getConfig('agent.provider');
  const configProvider = isAutonomous ? cfg.agent.autonomous_provider : cfg.agent.provider;
  const inferredProvider = inferProviderFromModel(model);

  const configuredProvider = dbProvider
    || (configProvider !== 'claude-code' || inferredProvider === 'claude-code' ? configProvider : undefined);

  return {
    provider: normalizeProvider(configuredProvider, model),
    model: stripProviderPrefix(model),
  };
}
