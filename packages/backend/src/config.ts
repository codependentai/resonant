import { readFileSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

// Derive project root from this module's location (packages/backend/src/config.ts → ../../..)
// This is stable regardless of process.cwd(), which npm workspaces can change.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const PROJECT_ROOT = resolve(__dirname, '..', '..', '..');

export interface ResonantConfig {
  identity: {
    companion_name: string;
    user_name: string;
    timezone: string;
    profile_path: string;
    companion_md_path: string;
    provider_overrides_path: string;
  };
  server: {
    port: number;
    host: string;
    db_path: string;
  };
  auth: {
    password: string;
  };
  agent: {
    provider: 'claude-code' | 'openai-codex' | 'openrouter';
    autonomous_provider: 'claude-code' | 'openai-codex' | 'openrouter';
    cwd: string;
    claude_md_path: string;
    mcp_json_path: string;
    model: string;
    model_autonomous: string;
    openai_codex_permission: string;
    claude_code: {
      mcp_json_path: string;
    };
    openai_codex: {
      permission: string;
    };
    openrouter: {
      base_url: string;
      api_key_env: string;
      api_key?: string;
      default_model: string;
    };
  };
  orchestrator: {
    enabled: boolean;
    wake_prompts_path: string;
    schedules: Record<string, string>;
    failsafe: {
      enabled: boolean;
      gentle_minutes: number;
      concerned_minutes: number;
      emergency_minutes: number;
    };
  };
  scribe: {
    enabled: boolean;
    provider: 'claude-code' | 'openai-codex' | 'openrouter';
    model: string;
    interval_minutes: number;
    digest_path: string;
    min_messages: number;
  };
  hooks: {
    context_injection: boolean;
    safe_write_prefixes: string[];
  };
  voice: {
    enabled: boolean;
    elevenlabs_voice_id: string;
  };
  push: {
    enabled: boolean;
    vapid_public_key_env: string;
    vapid_private_key_env: string;
    vapid_contact: string;
  };
  discord: {
    enabled: boolean;
    owner_user_id: string;
  };
  telegram: {
    enabled: boolean;
    owner_chat_id: string;
  };
  integrations: {
    life_api_url: string;
    mind_cloud: {
      enabled: boolean;
      mcp_url: string;
    };
  };
  command_center: {
    enabled: boolean;
    default_person: string;
    currency_symbol: string;
    care_categories: {
      toggles: string[];
      ratings: string[];
      counters: { name: string; max: number }[];
    };
  };
  cors: {
    origins: string[];
  };
}

const DEFAULTS: ResonantConfig = {
  identity: {
    companion_name: 'Echo',
    user_name: 'User',
    timezone: 'UTC',
    profile_path: './identity/companion.profile.yaml',
    companion_md_path: './identity/companion.md',
    provider_overrides_path: './identity/provider-overrides',
  },
  server: {
    port: 3002,
    host: '127.0.0.1',
    db_path: './data/resonant.db',
  },
  auth: {
    password: '',
  },
  agent: {
    provider: 'claude-code',
    autonomous_provider: 'claude-code',
    cwd: '.',
    claude_md_path: './CLAUDE.md',
    mcp_json_path: './.mcp.json',
    model: 'claude-sonnet-4-6',
    model_autonomous: 'claude-sonnet-4-6',
    openai_codex_permission: 'workspace-write',
    claude_code: {
      mcp_json_path: './.mcp.json',
    },
    openai_codex: {
      permission: 'workspace-write',
    },
    openrouter: {
      base_url: 'https://openrouter.ai/api/v1',
      api_key_env: 'OPENROUTER_API_KEY',
      api_key: '',
      default_model: '',
    },
  },
  orchestrator: {
    enabled: true,
    wake_prompts_path: './prompts/wake.md',
    schedules: {},
    failsafe: {
      enabled: false,
      gentle_minutes: 120,
      concerned_minutes: 720,
      emergency_minutes: 1440,
    },
  },
  scribe: {
    enabled: true,
    provider: 'claude-code',
    model: 'claude-sonnet-4-6',
    interval_minutes: 30,
    digest_path: './data/digests',
    min_messages: 5,
  },
  hooks: {
    context_injection: true,
    safe_write_prefixes: [],
  },
  voice: {
    enabled: false,
    elevenlabs_voice_id: '',
  },
  push: {
    enabled: true,
    vapid_public_key_env: 'VAPID_PUBLIC_KEY',
    vapid_private_key_env: 'VAPID_PRIVATE_KEY',
    vapid_contact: 'mailto:admin@example.com',
  },
  discord: {
    enabled: false,
    owner_user_id: '',
  },
  telegram: {
    enabled: false,
    owner_chat_id: '',
  },
  integrations: {
    life_api_url: '',
    mind_cloud: {
      enabled: false,
      mcp_url: '',
    },
  },
  command_center: {
    enabled: false,
    default_person: 'user',
    currency_symbol: '$',
    care_categories: {
      toggles: ['breakfast', 'lunch', 'dinner', 'snacks', 'medication', 'movement', 'shower'],
      ratings: ['sleep', 'energy', 'wellbeing', 'mood'],
      counters: [{ name: 'water', max: 10 }],
    },
  },
  cors: {
    origins: [],
  },
};

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) &&
        target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
      result[key] = deepMerge(target[key] as Record<string, unknown>, source[key] as Record<string, unknown>);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

let _config: ResonantConfig | null = null;

export function loadConfig(configPath?: string): ResonantConfig {
  if (_config) return _config;

  const explicitConfigPath = configPath || process.env.RESONANT_CONFIG;
  const searchPaths = explicitConfigPath
    ? [resolve(PROJECT_ROOT, explicitConfigPath)]
    : [
        join(PROJECT_ROOT, 'resonant.yaml'),
        join(PROJECT_ROOT, 'resonant.yml'),
        join(PROJECT_ROOT, 'config', 'resonant.yaml'),
      ];

  let fileConfig: Record<string, unknown> = {};

  for (const p of searchPaths) {
    if (existsSync(p)) {
      const raw = readFileSync(p, 'utf-8');
      fileConfig = yaml.load(raw) as Record<string, unknown> || {};
      console.log(`Loaded config from: ${p}`);
      break;
    }
  }

  // Merge: defaults <- yaml <- env overrides
  const merged = deepMerge(DEFAULTS as unknown as Record<string, unknown>, fileConfig) as unknown as ResonantConfig;

  // Environment variable overrides
  if (process.env.PORT) merged.server.port = parseInt(process.env.PORT, 10);
  if (process.env.HOST) merged.server.host = process.env.HOST;
  if (process.env.DB_PATH) merged.server.db_path = process.env.DB_PATH;
  if (process.env.APP_PASSWORD) merged.auth.password = process.env.APP_PASSWORD;
  if (process.env.AGENT_CWD) merged.agent.cwd = process.env.AGENT_CWD;
  if (process.env.AGENT_PROVIDER) merged.agent.provider = process.env.AGENT_PROVIDER as ResonantConfig['agent']['provider'];
  if (process.env.AGENT_AUTONOMOUS_PROVIDER) merged.agent.autonomous_provider = process.env.AGENT_AUTONOMOUS_PROVIDER as ResonantConfig['agent']['autonomous_provider'];
  if (process.env.AGENT_MODEL) merged.agent.model = process.env.AGENT_MODEL;
  if (process.env.AGENT_MODEL_AUTONOMOUS) merged.agent.model_autonomous = process.env.AGENT_MODEL_AUTONOMOUS;
  if (process.env.OPENAI_CODEX_PERMISSION) {
    merged.agent.openai_codex_permission = process.env.OPENAI_CODEX_PERMISSION;
    merged.agent.openai_codex.permission = process.env.OPENAI_CODEX_PERMISSION;
  }
  const openRouterKeyEnv = merged.agent.openrouter.api_key_env || 'OPENROUTER_API_KEY';
  if (process.env[openRouterKeyEnv]) merged.agent.openrouter.api_key = process.env[openRouterKeyEnv];
  if (process.env.COMPANION_NAME) merged.identity.companion_name = process.env.COMPANION_NAME;
  if (process.env.USER_NAME) merged.identity.user_name = process.env.USER_NAME;
  if (process.env.TZ) merged.identity.timezone = process.env.TZ;
  if (process.env.DISCORD_ENABLED === 'true') merged.discord.enabled = true;
  if (process.env.TELEGRAM_ENABLED === 'true') merged.telegram.enabled = true;

  // Resolve relative paths against the project root (not cwd)
  const resolveFromRoot = (p: string) => resolve(PROJECT_ROOT, p);
  merged.server.db_path = resolveFromRoot(merged.server.db_path);
  merged.identity.profile_path = resolveFromRoot(merged.identity.profile_path);
  merged.identity.companion_md_path = resolveFromRoot(merged.identity.companion_md_path);
  merged.identity.provider_overrides_path = resolveFromRoot(merged.identity.provider_overrides_path);
  merged.agent.cwd = resolveFromRoot(merged.agent.cwd);
  merged.agent.claude_md_path = resolveFromRoot(merged.agent.claude_md_path);
  merged.agent.mcp_json_path = resolveFromRoot(merged.agent.mcp_json_path);
  merged.agent.claude_code.mcp_json_path = resolveFromRoot(merged.agent.claude_code.mcp_json_path || merged.agent.mcp_json_path);
  merged.orchestrator.wake_prompts_path = resolveFromRoot(merged.orchestrator.wake_prompts_path);
  merged.scribe.digest_path = resolveFromRoot(merged.scribe.digest_path);

  _config = merged;
  return merged;
}

export function getResonantConfig(): ResonantConfig {
  if (!_config) throw new Error('Config not loaded. Call loadConfig() first.');
  return _config;
}
