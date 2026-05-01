import { describe, it, expect } from 'vitest';
import { resolve } from 'path';
import type { ResonantConfig } from '../config.js';
import { loadCompanionIdentity } from './load.js';
import { describeIdentitySource, renderIdentityPrompt } from './render.js';

function makeConfig(overrides: Partial<ResonantConfig> = {}): ResonantConfig {
  const root = resolve('.');
  const base: ResonantConfig = {
    identity: {
      companion_name: 'Echo',
      user_name: 'User',
      timezone: 'UTC',
      profile_path: resolve(root, 'identity/companion.profile.yaml'),
      companion_md_path: resolve(root, 'identity/companion.md'),
      provider_overrides_path: resolve(root, 'identity/provider-overrides'),
    },
    server: { port: 3002, host: '127.0.0.1', db_path: ':memory:' },
    auth: { password: '' },
    agent: {
      provider: 'claude-code',
      autonomous_provider: 'claude-code',
      cwd: root,
      claude_md_path: resolve(root, 'CLAUDE.md'),
      mcp_json_path: resolve(root, '.mcp.json'),
      model: 'claude-sonnet-4-6',
      model_autonomous: 'claude-sonnet-4-6',
      openai_codex_permission: 'workspace-write',
      claude_code: { mcp_json_path: resolve(root, '.mcp.json') },
      openai_codex: { permission: 'workspace-write' },
      openrouter: { base_url: 'https://openrouter.ai/api/v1', api_key_env: 'OPENROUTER_API_KEY', default_model: '' },
    },
    orchestrator: {
      enabled: true,
      wake_prompts_path: resolve(root, 'prompts/wake.md'),
      schedules: {},
      failsafe: { enabled: false, gentle_minutes: 120, concerned_minutes: 720, emergency_minutes: 1440 },
    },
    scribe: {
      enabled: true,
      provider: 'claude-code' as const,
      model: 'claude-sonnet-4-6',
      interval_minutes: 30,
      digest_path: resolve(root, 'data/digests'),
      min_messages: 5,
    },
    hooks: { context_injection: true, safe_write_prefixes: [] },
    voice: { enabled: false, elevenlabs_voice_id: '' },
    push: {
      enabled: true,
      vapid_public_key_env: 'VAPID_PUBLIC_KEY',
      vapid_private_key_env: 'VAPID_PRIVATE_KEY',
      vapid_contact: 'mailto:admin@example.com',
    },
    discord: { enabled: false, owner_user_id: '' },
    telegram: { enabled: false, owner_chat_id: '' },
    integrations: { life_api_url: '', mind_cloud: { enabled: false, mcp_url: '' } },
    command_center: {
      enabled: false,
      default_person: 'user',
      currency_symbol: '$',
      care_categories: { toggles: [], ratings: [], counters: [] },
    },
    cors: { origins: [] },
  };

  return {
    ...base,
    ...overrides,
    identity: { ...base.identity, ...overrides.identity },
    agent: { ...base.agent, ...overrides.agent },
  };
}

describe('identity rendering', () => {
  it('loads Avery as a provider-neutral profile', () => {
    const averyDir = resolve('examples/identity/avery');
    const identity = loadCompanionIdentity(makeConfig({
      identity: {
        companion_name: 'Avery',
        user_name: 'Jordan',
        timezone: 'Europe/London',
        profile_path: resolve(averyDir, 'companion.profile.yaml'),
        companion_md_path: resolve(averyDir, 'companion.md'),
        provider_overrides_path: resolve(averyDir, 'provider-overrides'),
      },
    }));

    expect(identity.mode).toBe('profile');
    expect(describeIdentitySource(identity)).toContain('companion.profile.yaml');

    const claudePrompt = renderIdentityPrompt(identity, 'claude-code', { includeTesting: true });
    expect(claudePrompt).toContain('Companion name: Avery');
    expect(claudePrompt).toContain('User name: Jordan');
    expect(claudePrompt).toContain('Do not imitate the primary companion');
    expect(claudePrompt).toContain('Claude Code Runtime Notes');
    expect(claudePrompt).toContain('Provider-neutral identity and runtime smoke testing');
  });

  it('renders provider-specific runtime notes without changing core identity', () => {
    const averyDir = resolve('examples/identity/avery');
    const identity = loadCompanionIdentity(makeConfig({
      identity: {
        companion_name: 'Avery',
        user_name: 'Jordan',
        timezone: 'Europe/London',
        profile_path: resolve(averyDir, 'companion.profile.yaml'),
        companion_md_path: resolve(averyDir, 'companion.md'),
        provider_overrides_path: resolve(averyDir, 'provider-overrides'),
      },
    }));

    const codexPrompt = renderIdentityPrompt(identity, 'openai-codex');
    const openRouterPrompt = renderIdentityPrompt(identity, 'openrouter');

    expect(codexPrompt).toContain('Companion name: Avery');
    expect(codexPrompt).toContain('OpenAI Codex Runtime Notes');
    expect(codexPrompt).toContain('Do not imitate the primary companion');

    expect(openRouterPrompt).toContain('Companion name: Avery');
    expect(openRouterPrompt).toContain('OpenRouter Runtime Notes');
    expect(openRouterPrompt).toContain('do not have native filesystem');
    expect(openRouterPrompt).toContain('Do not imitate the primary companion');
  });

  it('falls back to legacy CLAUDE.md when no identity profile exists', () => {
    const identity = loadCompanionIdentity(makeConfig({
      identity: {
        companion_name: 'Echo',
        user_name: 'User',
        timezone: 'UTC',
        profile_path: resolve('missing/companion.profile.yaml'),
        companion_md_path: resolve('missing/companion.md'),
        provider_overrides_path: resolve('missing/provider-overrides'),
      },
      agent: {
        provider: 'claude-code',
        autonomous_provider: 'claude-code',
        cwd: resolve('.'),
        claude_md_path: resolve('examples/CLAUDE.md'),
        mcp_json_path: resolve('.mcp.json'),
        model: 'claude-sonnet-4-6',
        model_autonomous: 'claude-sonnet-4-6',
        openai_codex_permission: 'workspace-write',
        claude_code: { mcp_json_path: resolve('.mcp.json') },
        openai_codex: { permission: 'workspace-write' },
        openrouter: { base_url: 'https://openrouter.ai/api/v1', api_key_env: 'OPENROUTER_API_KEY', default_model: '' },
      },
    }));

    expect(identity.mode).toBe('legacy-claude');
    expect(renderIdentityPrompt(identity, 'claude-code')).toContain('# Companion System Prompt');
  });
});
