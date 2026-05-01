import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import type { ResonantConfig } from '../config.js';
import type { CompanionProfile, IdentityProvider, LoadedCompanionIdentity } from './types.js';

const PROVIDER_OVERRIDE_FILES: Record<IdentityProvider, string> = {
  'claude-code': 'claude-code.md',
  'openai-codex': 'openai-codex.md',
  openrouter: 'openrouter.md',
  'openai-api': 'openai-api.md',
  'openai-compatible': 'openai-compatible.md',
};

function readIfExists(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf-8') : '';
}

function loadProviderOverrides(overridesPath: string): Partial<Record<IdentityProvider, string>> {
  const overrides: Partial<Record<IdentityProvider, string>> = {};
  if (!existsSync(overridesPath)) return overrides;

  for (const [provider, filename] of Object.entries(PROVIDER_OVERRIDE_FILES) as [IdentityProvider, string][]) {
    const path = join(overridesPath, filename);
    const content = readIfExists(path).trim();
    if (content) overrides[provider] = content;
  }

  return overrides;
}

function parseProfile(path: string): CompanionProfile | null {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf-8');
  return (yaml.load(raw) as CompanionProfile) || {};
}

export function findLegacyClaudePath(config: ResonantConfig): string | null {
  const candidates = [
    config.agent.claude_md_path,
    join(config.agent.cwd, '.claude/CLAUDE.md'),
    join(config.agent.cwd, 'CLAUDE.md'),
  ];

  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

export function loadCompanionIdentity(config: ResonantConfig): LoadedCompanionIdentity {
  const profile = parseProfile(config.identity.profile_path);
  const companionMarkdown = readIfExists(config.identity.companion_md_path).trim();

  if (profile || companionMarkdown) {
    return {
      mode: 'profile',
      profile,
      companionMarkdown,
      legacyPrompt: '',
      providerOverrides: loadProviderOverrides(config.identity.provider_overrides_path),
      sourcePaths: {
        ...(profile && { profile: config.identity.profile_path }),
        ...(companionMarkdown && { companionMarkdown: config.identity.companion_md_path }),
        providerOverrides: config.identity.provider_overrides_path,
      },
    };
  }

  const legacyClaudePath = findLegacyClaudePath(config);
  const legacyPrompt = legacyClaudePath ? readFileSync(legacyClaudePath, 'utf-8') : '';

  return {
    mode: 'legacy-claude',
    profile: null,
    companionMarkdown: '',
    legacyPrompt,
    providerOverrides: {},
    sourcePaths: {
      ...(legacyClaudePath && { legacyClaude: legacyClaudePath }),
    },
  };
}
