import type { RuntimeCapabilities, RuntimeProviderId } from './types.js';

export const RUNTIME_CAPABILITIES: Record<RuntimeProviderId, RuntimeCapabilities> = {
  'claude-code': {
    subscription: true,
    byok: false,
    tools: true,
    nativeTools: true,
    mcp: true,
    rewind: true,
    thinking: true,
    autonomous: true,
    sessions: true,
  },
  'openai-codex': {
    subscription: true,
    byok: false,
    tools: true,
    nativeTools: false,
    mcp: false,
    rewind: false,
    thinking: false,
    autonomous: true,
    sessions: false,
    experimental: true,
  },
  openrouter: {
    subscription: false,
    byok: true,
    tools: false,
    nativeTools: false,
    mcp: false,
    rewind: false,
    thinking: false,
    autonomous: false,
    sessions: false,
    planned: true,
  },
};

export function isRuntimeProviderId(value: string): value is RuntimeProviderId {
  return value === 'claude-code' || value === 'openai-codex' || value === 'openrouter';
}
