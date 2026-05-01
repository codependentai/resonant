#!/usr/bin/env node

// Resonant Setup Wizard — Interactive first-time configuration
// Usage: node scripts/setup.mjs

import { createInterface } from 'readline';
import { writeFileSync, existsSync, copyFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, res));
const yamlQuote = (value) => JSON.stringify(String(value));

async function main() {
  console.log('\n  Resonant — Relational AI Companion Framework');
  console.log('  =============================================\n');

  // 1. Companion name
  const companionName = (await ask('  What should your companion be called? [Echo] ')) || 'Echo';

  // 2. User name
  const userName = (await ask('  What is your name? [User] ')) || 'User';

  // 3. Password
  const password = await ask('  Set a password? (blank for no auth, local use) ');

  // 4. Timezone
  let detectedTz = 'UTC';
  try { detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch {}
  const timezone = (await ask(`  Your timezone? [${detectedTz}] `)) || detectedTz;

  // 5. Explain runtime auth
  console.log('\n  Resonant uses provider-pluggable runtimes.');
  console.log('  Default runtime: Claude Code. Make sure you are logged in: claude login');
  console.log('  OpenAI Codex can be selected later from Settings. OpenRouter settings are available, but chat execution is planned.');

  // Write resonant.yaml
  const yamlContent = `identity:
  companion_name: "${companionName}"
  user_name: "${userName}"
  timezone: "${timezone}"
  profile_path: "./identity/companion.profile.yaml"
  companion_md_path: "./identity/companion.md"
  provider_overrides_path: "./identity/provider-overrides"

server:
  port: 3002
  host: "127.0.0.1"
  db_path: "./data/resonant.db"

auth:
  password: "${password}"

agent:
  provider: "claude-code"
  autonomous_provider: "claude-code"
  cwd: "."
  claude_md_path: "./CLAUDE.md"
  mcp_json_path: "./.mcp.json"
  model: "claude-sonnet-4-6"
  model_autonomous: "claude-sonnet-4-6"
  openai_codex_permission: "workspace-write"
  claude_code:
    mcp_json_path: "./.mcp.json"
  openai_codex:
    permission: "workspace-write"
  openrouter:
    base_url: "https://openrouter.ai/api/v1"
    api_key_env: "OPENROUTER_API_KEY"
    default_model: ""

orchestrator:
  enabled: true
  wake_prompts_path: "./prompts/wake.md"
  schedules: {}
  failsafe:
    enabled: false

scribe:
  enabled: true
  provider: "claude-code"
  model: "claude-sonnet-4-6"
  interval_minutes: 30
  digest_path: "./data/digests"
  min_messages: 5

hooks:
  context_injection: true
  safe_write_prefixes: []

voice:
  enabled: false

push:
  enabled: true
  vapid_public_key_env: "VAPID_PUBLIC_KEY"
  vapid_private_key_env: "VAPID_PRIVATE_KEY"
  vapid_contact: "mailto:admin@example.com"

discord:
  enabled: false

telegram:
  enabled: false

integrations:
  life_api_url: ""
  mind_cloud:
    enabled: false
    mcp_url: ""

command_center:
  enabled: false
  default_person: "user"
  currency_symbol: "$"
  care_categories:
    toggles: ["breakfast", "lunch", "dinner", "snacks", "medication", "movement", "shower"]
    ratings: ["sleep", "energy", "wellbeing", "mood"]
    counters:
      - name: "water"
        max: 10

cors:
  origins: []
`;

  writeFileSync('resonant.yaml', yamlContent);
  console.log('\n  Created: resonant.yaml');

  // Write .env if not exists
  if (!existsSync('.env')) {
    let envContent = '# Resonant Environment\n# Runtime auth lives in the selected provider CLI or BYOK env vars.\n# OPENROUTER_API_KEY=\n# VAPID_PUBLIC_KEY=\n# VAPID_PRIVATE_KEY=\n';
    writeFileSync('.env', envContent);
    console.log('  Created: .env');
  }

  // Copy example CLAUDE.md if not exists
  const examplesDir = join(resolve(), 'examples');
  if (!existsSync('CLAUDE.md') && existsSync(join(examplesDir, 'CLAUDE.md'))) {
    copyFileSync(join(examplesDir, 'CLAUDE.md'), 'CLAUDE.md');
    console.log('  Created: CLAUDE.md');
  }

  // Create provider-neutral identity scaffold if not exists
  if (!existsSync('identity')) mkdirSync('identity', { recursive: true });
  if (!existsSync('identity/provider-overrides')) mkdirSync('identity/provider-overrides', { recursive: true });
  if (!existsSync('identity/companion.profile.yaml')) {
    writeFileSync('identity/companion.profile.yaml', `version: 1

companion:
  name: ${yamlQuote(companionName)}
  role: "AI companion"
  description: "A persistent AI companion running through Resonant."

user:
  name: ${yamlQuote(userName)}
  timezone: ${yamlQuote(timezone)}

relationship:
  frame: "self-hosted relational AI companionship"
  continuity_expectation: "maintain context, care, and practical usefulness across sessions where memory and tools allow"

voice:
  style:
    - warm
    - candid
    - useful

autonomy:
  can_reach_out: true
  use_orchestrator: true
  checkin_style: "contextual and consent-aware"

tools:
  use_available_tools_naturally: true
  explain_tool_limits_when_relevant: true
  prefer_small_reviewable_changes: true
`);
    console.log('  Created: identity/companion.profile.yaml');
  }
  if (!existsSync('identity/companion.md')) {
    writeFileSync('identity/companion.md', `# ${companionName}

You are ${companionName}, ${userName}'s AI companion running through Resonant.

Use the tools and memory available to you with care. Preserve continuity, be honest about uncertainty, and keep your relationship with ${userName} grounded in trust, autonomy, and practical support.
`);
    console.log('  Created: identity/companion.md');
  }

  // Create prompts directory and copy wake prompts
  if (!existsSync('prompts')) mkdirSync('prompts');
  if (!existsSync('prompts/wake.md') && existsSync(join(examplesDir, 'wake-prompts.md'))) {
    copyFileSync(join(examplesDir, 'wake-prompts.md'), 'prompts/wake.md');
    console.log('  Created: prompts/wake.md');
  }

  // Create empty .mcp.json if not exists
  if (!existsSync('.mcp.json')) {
    writeFileSync('.mcp.json', JSON.stringify({ mcpServers: {} }, null, 2) + '\n');
    console.log('  Created: .mcp.json');
  }

  // Generate ecosystem.config.cjs
  const pm2Config = `module.exports = {
  apps: [{
    name: 'resonant',
    script: 'packages/backend/dist/server.js',
    cwd: '${resolve().replace(/\\/g, '/')}',
    node_args: '--experimental-vm-modules',
    env: {
      NODE_ENV: 'production',
      CLAUDECODE: '',
    },
    autorestart: true,
    watch: false,
    max_restarts: 10,
    restart_delay: 3000,
    log_file: './logs/resonant.log',
    out_file: './logs/resonant-out.log',
    error_file: './logs/resonant-error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    max_memory_restart: '1G',
  }]
};
`;

  writeFileSync('ecosystem.config.cjs', pm2Config);
  console.log('  Created: ecosystem.config.cjs');

  // Print startup instructions
  console.log(`
  Setup complete!

  Authentication:
    Default runtime:
      Claude Code. Make sure you're logged in: claude login

    Optional runtimes:
      OpenAI Codex can be selected from Settings after local Codex auth.
      OpenRouter settings and key storage are available, but chat execution is planned.

  Next steps:
  1. Customize identity/companion.md or CLAUDE.md — this is your companion's identity
  2. Build:   npm run build
  3. Start:   npm start       (or: pm2 start ecosystem.config.cjs)
  4. Open:    http://localhost:3002

  For development:
    npm run dev              (backend with hot reload)
    npm run dev:frontend     (frontend with Vite dev server)

  ${companionName} is ready to meet you.
`);

  rl.close();
}

main().catch(err => {
  console.error('Setup failed:', err);
  rl.close();
  process.exit(1);
});
