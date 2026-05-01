import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ResonantConfig } from '../config.js';

const dbConfig = new Map<string, string>();

vi.mock('../services/db.js', () => ({
  getConfig: vi.fn((key: string) => dbConfig.get(key) || null),
}));

import { resolveRuntimeSelection } from './selection.js';

function config(overrides: Partial<ResonantConfig['agent']> = {}): ResonantConfig {
  return {
    identity: {
      companion_name: 'Echo',
      user_name: 'User',
      timezone: 'UTC',
      profile_path: '',
      companion_md_path: '',
      provider_overrides_path: '',
    },
    server: { port: 3002, host: '127.0.0.1', db_path: ':memory:' },
    auth: { password: '' },
    agent: {
      provider: 'claude-code',
      autonomous_provider: 'claude-code',
      cwd: '.',
      claude_md_path: './CLAUDE.md',
      mcp_json_path: './.mcp.json',
      model: 'claude-sonnet-4-6',
      model_autonomous: 'claude-haiku-4-5',
      openai_codex_permission: 'workspace-write',
      claude_code: { mcp_json_path: './.mcp.json' },
      openai_codex: { permission: 'workspace-write' },
      openrouter: { base_url: 'https://openrouter.ai/api/v1', api_key_env: 'OPENROUTER_API_KEY', default_model: '' },
      ...overrides,
    },
    orchestrator: {
      enabled: false,
      wake_prompts_path: '',
      schedules: {},
      failsafe: { enabled: false, gentle_minutes: 120, concerned_minutes: 720, emergency_minutes: 1440 },
    },
    scribe: {
      enabled: true,
      provider: 'claude-code' as const,
      model: 'claude-sonnet-4-6',
      interval_minutes: 30,
      digest_path: './data/digests',
      min_messages: 5,
    },
    hooks: { context_injection: true, safe_write_prefixes: [] },
    voice: { enabled: false, elevenlabs_voice_id: '' },
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
}

beforeEach(() => {
  dbConfig.clear();
});

describe('resolveRuntimeSelection', () => {
  it('defaults missing provider to Claude Code', () => {
    const selected = resolveRuntimeSelection(false, config());
    expect(selected).toEqual({ provider: 'claude-code', model: 'claude-sonnet-4-6' });
  });

  it('infers Codex from GPT model when provider is not explicitly set', () => {
    const selected = resolveRuntimeSelection(false, config({ provider: undefined as any, model: 'gpt-5.4' }));
    expect(selected).toEqual({ provider: 'openai-codex', model: 'gpt-5.4' });
  });

  it('keeps legacy GPT DB model routed to Codex when provider only comes from defaults', () => {
    dbConfig.set('agent.model', 'gpt-5.5');
    const selected = resolveRuntimeSelection(false, config());
    expect(selected).toEqual({ provider: 'openai-codex', model: 'gpt-5.5' });
  });

  it('honors explicit DB provider and strips model prefixes', () => {
    dbConfig.set('agent.provider', 'openrouter');
    dbConfig.set('agent.model', 'openrouter:anthropic/claude-sonnet-4.5');
    const selected = resolveRuntimeSelection(false, config());
    expect(selected).toEqual({ provider: 'openrouter', model: 'anthropic/claude-sonnet-4.5' });
  });

  it('uses autonomous provider and model for autonomous runs', () => {
    dbConfig.set('agent.autonomous_provider', 'openai-codex');
    dbConfig.set('agent.model_autonomous', 'gpt-5.3-codex');
    const selected = resolveRuntimeSelection(true, config());
    expect(selected).toEqual({ provider: 'openai-codex', model: 'gpt-5.3-codex' });
  });
});
