import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
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
    },
    server: { port: 3002, host: '127.0.0.1', db_path: ':memory:' },
    auth: { password: '' },
    agent: {
      cwd: root,
      claude_md_path: resolve(root, 'CLAUDE.md'),
      mcp_json_path: resolve(root, '.mcp.json'),
      model: 'claude-sonnet-4-6',
      model_autonomous: 'claude-sonnet-4-6',
    },
    orchestrator: {
      enabled: true,
      wake_prompts_path: resolve(root, 'prompts/wake.md'),
      wake_prompts_dir: resolve(root, 'prompts/wakes'),
      schedules: {},
      failsafe: { enabled: false, gentle_minutes: 120, concerned_minutes: 720, emergency_minutes: 1440 },
    },
    handoff: { enabled: false },
    hooks: { context_injection: true, safe_write_prefixes: [], workspace_root: '', vault_path: '', extra_write_paths: [] },
    voice: { enabled: false, elevenlabs_voice_id: '' },
    discord: { enabled: false, owner_user_id: '' },
    telegram: { enabled: false, owner_chat_id: '' },
    integrations: { life_api_url: '', mind_cloud: { enabled: false, mcp_url: '' } },
    google: { enabled: false, client_id: '', client_secret: '' },
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
  it('loads a structured Claude companion identity when configured', () => {
    const dir = mkdtempSync(join(tmpdir(), 'resonant-identity-'));
    const profilePath = join(dir, 'companion.profile.yaml');
    const companionPath = join(dir, 'companion.md');

    writeFileSync(profilePath, [
      'companion:',
      '  name: Avery',
      '  role: collaborator',
      'user:',
      '  name: Jordan',
      'relationship:',
      '  boundaries:',
      '    - Do not imitate the primary companion',
      'voice:',
      '  style:',
      '    - warm',
      'values:',
      '  - continuity',
      '',
    ].join('\n'));
    writeFileSync(companionPath, 'Avery is steady, direct, and careful.');

    const identity = loadCompanionIdentity(makeConfig({
      identity: {
        companion_name: 'Avery',
        user_name: 'Jordan',
        timezone: 'Europe/London',
        profile_path: profilePath,
        companion_md_path: companionPath,
      },
    }));

    expect(identity.mode).toBe('profile');
    expect(describeIdentitySource(identity)).toContain('companion.profile.yaml');

    const prompt = renderIdentityPrompt(identity);
    expect(prompt).toContain('Companion name: Avery');
    expect(prompt).toContain('User name: Jordan');
    expect(prompt).toContain('Do not imitate the primary companion');
    expect(prompt).toContain('Avery is steady, direct, and careful.');
  });

  it('falls back to legacy CLAUDE.md when no identity profile exists', () => {
    const identity = loadCompanionIdentity(makeConfig({
      identity: {
        companion_name: 'Echo',
        user_name: 'User',
        timezone: 'UTC',
        profile_path: resolve('missing/companion.profile.yaml'),
        companion_md_path: resolve('missing/companion.md'),
      },
      agent: {
        cwd: resolve('.'),
        claude_md_path: resolve('examples/CLAUDE.md'),
        mcp_json_path: resolve('.mcp.json'),
        model: 'claude-sonnet-4-6',
        model_autonomous: 'claude-sonnet-4-6',
      },
    }));

    expect(identity.mode).toBe('legacy-claude');
    expect(renderIdentityPrompt(identity)).toContain('# Personal AI System Prompt');
  });
});
