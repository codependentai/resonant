import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import { ClaudeCodeProvider } from './providers/claude-code-provider.js';
import { OpenAICodexProvider } from './providers/openai-codex-provider.js';
import { OpenRouterProvider } from './providers/openrouter-provider.js';
import type { RuntimeProvider, RuntimeProviderId } from './types.js';

export class RuntimeProviderManager {
  private readonly providers: Record<RuntimeProviderId, RuntimeProvider>;

  constructor(mcpServers: Record<string, McpServerConfig>, agentCwd = process.cwd()) {
    this.providers = {
      'claude-code': new ClaudeCodeProvider(mcpServers, agentCwd),
      'openai-codex': new OpenAICodexProvider(),
      openrouter: new OpenRouterProvider(),
    };
  }

  get(providerId: RuntimeProviderId): RuntimeProvider {
    return this.providers[providerId];
  }

  all(): RuntimeProvider[] {
    return Object.values(this.providers);
  }
}
