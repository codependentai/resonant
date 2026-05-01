import { RUNTIME_CAPABILITIES } from '../capabilities.js';
import type { RuntimeEvent, RuntimeProvider, RuntimeQuery } from '../types.js';

export class OpenRouterProvider implements RuntimeProvider {
  readonly id = 'openrouter' as const;
  readonly label = 'OpenRouter';
  readonly capabilities = RUNTIME_CAPABILITIES.openrouter;

  async *run(_query: RuntimeQuery): AsyncGenerator<RuntimeEvent> {
    yield {
      type: 'error',
      message: 'OpenRouter is configured as a planned provider. Context and tool normalization must land before enabling API execution.',
    };
    yield {
      type: 'done',
      responseText: '[OpenRouter provider is planned but not enabled in this build]',
    };
  }
}
