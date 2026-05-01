<script lang="ts">
  import { onMount } from 'svelte';

  interface Preferences {
    identity: {
      companion_name: string;
      user_name: string;
      timezone: string;
      profile_path?: string;
      companion_md_path?: string;
      provider_overrides_path?: string;
      profile_yaml?: string;
      companion_markdown?: string;
      provider_overrides?: {
        claude_code?: string;
        openai_codex?: string;
        openrouter?: string;
      };
    };
    agent: {
      provider: string;
      autonomous_provider: string;
      model: string;
      model_autonomous: string;
      openai_codex_permission?: string;
      openrouter?: {
        base_url?: string;
        api_key_env?: string;
        default_model?: string;
        api_key_set?: boolean;
      };
    };
    providers?: Record<string, unknown>;
    scribe: {
      enabled: boolean;
      provider: string;
      model: string;
      interval_minutes: number;
      digest_path: string;
      min_messages: number;
    };
    hooks: { context_injection: boolean; safe_write_prefixes: string[] };
    orchestrator: { enabled: boolean; wake_prompts_path?: string };
    voice: { enabled: boolean; elevenlabs_voice_id?: string };
    discord: { enabled: boolean; owner_user_id?: string };
    telegram: { enabled: boolean; owner_chat_id?: string };
    integrations: { life_api_url: string; mind_cloud: { enabled: boolean; mcp_url: string } };
    command_center: {
      enabled: boolean;
      default_person: string;
      currency_symbol: string;
      care_categories: { toggles: string[]; ratings: string[]; counters: { name: string; max: number }[] };
    };
    cors: { origins: string[] };
    auth: { has_password: boolean };
  }

  let prefs = $state<Preferences | null>(null);
  let loading = $state(true);
  let saving = $state(false);
  let message = $state<string | null>(null);
  let error = $state<string | null>(null);

  // Editable drafts
  let companionName = $state('');
  let userName = $state('');
  let timezone = $state('');
  let identityProfilePath = $state('');
  let identityNarrativePath = $state('');
  let identityOverridesPath = $state('');
  let identityProfileYaml = $state('');
  let identityNarrative = $state('');
  let claudeRuntimeNotes = $state('');
  let codexRuntimeNotes = $state('');
  let openRouterRuntimeNotes = $state('');
  let model = $state('');
  let modelAutonomous = $state('');
  let provider = $state('claude-code');
  let autonomousProvider = $state('claude-code');
  let codexPermission = $state('workspace-write');
  let openRouterBaseUrl = $state('https://openrouter.ai/api/v1');
  let openRouterApiKeyEnv = $state('OPENROUTER_API_KEY');
  let openRouterDefaultModel = $state('');
  let openRouterApiKey = $state('');
  let openRouterApiKeySet = $state(false);
  let clearOpenRouterApiKey = $state(false);
  let scribeEnabled = $state(true);
  let scribeProvider = $state('claude-code');
  let scribeModel = $state('claude-sonnet-4-6');
  let scribeIntervalMinutes = $state(30);
  let scribeDigestPath = $state('./data/digests');
  let scribeMinMessages = $state(5);
  let contextInjection = $state(true);
  let safeWritePrefixes = $state('');
  let orchestratorEnabled = $state(true);
  let wakePromptsPath = $state('./prompts/wake.md');
  let voiceEnabled = $state(false);
  let elevenlabsVoiceId = $state('');
  let discordEnabled = $state(false);
  let discordOwnerUserId = $state('');
  let telegramEnabled = $state(false);
  let telegramOwnerChatId = $state('');
  let lifeApiUrl = $state('');
  let mindCloudEnabled = $state(false);
  let mindCloudMcpUrl = $state('');
  let commandCenterEnabled = $state(false);
  let commandCenterDefaultPerson = $state('user');
  let currencySymbol = $state('$');
  let careToggles = $state('');
  let careRatings = $state('');
  let careCountersJson = $state('[]');
  let corsOrigins = $state('');
  let newPassword = $state('');

  const MODELS = [
    { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', provider: 'claude-code' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'claude-code' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', provider: 'claude-code' },
    { id: 'gpt-5.5', label: 'GPT-5.5', provider: 'openai-codex' },
    { id: 'gpt-5.4', label: 'GPT-5.4', provider: 'openai-codex' },
    { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', provider: 'openai-codex' },
    { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', provider: 'openai-codex' },
    { id: 'gpt-5.2', label: 'GPT-5.2', provider: 'openai-codex' },
  ];

  const PROVIDERS = [
    { id: 'claude-code', label: 'Claude Code subscription' },
    { id: 'openai-codex', label: 'OpenAI Codex subscription' },
    { id: 'openrouter', label: 'OpenRouter BYOK (planned)' },
  ];

  const COMMON_TIMEZONES = [
    'UTC',
    'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'Europe/London', 'Europe/Paris', 'Europe/Berlin',
    'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Kolkata',
    'Australia/Sydney', 'Pacific/Auckland',
  ];

  function assertPreferences(data: unknown): Preferences {
    const maybePrefs = data as Partial<Preferences> & { error?: string };
    if (maybePrefs?.error) {
      throw new Error(maybePrefs.error);
    }
    if (!maybePrefs?.identity || !maybePrefs.agent || !maybePrefs.scribe || !maybePrefs.hooks || !maybePrefs.orchestrator || !maybePrefs.voice || !maybePrefs.discord || !maybePrefs.telegram || !maybePrefs.integrations || !maybePrefs.command_center || !maybePrefs.cors || !maybePrefs.auth) {
      throw new Error('Preferences response was incomplete');
    }
    return maybePrefs as Preferences;
  }

  async function loadPrefs() {
    loading = true;
    message = null;
    error = null;
    try {
      const res = await fetch('/api/preferences');
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Failed to load preferences (${res.status})`);
      const loadedPrefs = assertPreferences(data);
      prefs = loadedPrefs;
      // Populate drafts
      companionName = loadedPrefs.identity.companion_name;
      userName = loadedPrefs.identity.user_name;
      timezone = loadedPrefs.identity.timezone;
      identityProfilePath = loadedPrefs.identity.profile_path || '';
      identityNarrativePath = loadedPrefs.identity.companion_md_path || '';
      identityOverridesPath = loadedPrefs.identity.provider_overrides_path || '';
      identityProfileYaml = loadedPrefs.identity.profile_yaml || '';
      identityNarrative = loadedPrefs.identity.companion_markdown || '';
      claudeRuntimeNotes = loadedPrefs.identity.provider_overrides?.claude_code || '';
      codexRuntimeNotes = loadedPrefs.identity.provider_overrides?.openai_codex || '';
      openRouterRuntimeNotes = loadedPrefs.identity.provider_overrides?.openrouter || '';
      provider = loadedPrefs.agent.provider || 'claude-code';
      autonomousProvider = loadedPrefs.agent.autonomous_provider || 'claude-code';
      model = loadedPrefs.agent.model;
      modelAutonomous = loadedPrefs.agent.model_autonomous;
      codexPermission = loadedPrefs.agent.openai_codex_permission || 'workspace-write';
      openRouterBaseUrl = loadedPrefs.agent.openrouter?.base_url || 'https://openrouter.ai/api/v1';
      openRouterApiKeyEnv = loadedPrefs.agent.openrouter?.api_key_env || 'OPENROUTER_API_KEY';
      openRouterDefaultModel = loadedPrefs.agent.openrouter?.default_model || '';
      openRouterApiKeySet = !!loadedPrefs.agent.openrouter?.api_key_set;
      openRouterApiKey = '';
      clearOpenRouterApiKey = false;
      scribeEnabled = loadedPrefs.scribe.enabled;
      scribeProvider = loadedPrefs.scribe.provider || 'claude-code';
      scribeModel = loadedPrefs.scribe.model || 'claude-sonnet-4-6';
      scribeIntervalMinutes = loadedPrefs.scribe.interval_minutes || 30;
      scribeDigestPath = loadedPrefs.scribe.digest_path || './data/digests';
      scribeMinMessages = loadedPrefs.scribe.min_messages || 5;
      contextInjection = loadedPrefs.hooks.context_injection;
      safeWritePrefixes = (loadedPrefs.hooks.safe_write_prefixes || []).join('\n');
      orchestratorEnabled = loadedPrefs.orchestrator.enabled;
      wakePromptsPath = loadedPrefs.orchestrator.wake_prompts_path || './prompts/wake.md';
      voiceEnabled = loadedPrefs.voice.enabled;
      elevenlabsVoiceId = loadedPrefs.voice.elevenlabs_voice_id || '';
      discordEnabled = loadedPrefs.discord.enabled;
      discordOwnerUserId = loadedPrefs.discord.owner_user_id || '';
      telegramEnabled = loadedPrefs.telegram.enabled;
      telegramOwnerChatId = loadedPrefs.telegram.owner_chat_id || '';
      lifeApiUrl = loadedPrefs.integrations.life_api_url || '';
      mindCloudEnabled = loadedPrefs.integrations.mind_cloud?.enabled || false;
      mindCloudMcpUrl = loadedPrefs.integrations.mind_cloud?.mcp_url || '';
      commandCenterEnabled = loadedPrefs.command_center.enabled;
      commandCenterDefaultPerson = loadedPrefs.command_center.default_person || 'user';
      currencySymbol = loadedPrefs.command_center.currency_symbol || '$';
      careToggles = (loadedPrefs.command_center.care_categories?.toggles || []).join('\n');
      careRatings = (loadedPrefs.command_center.care_categories?.ratings || []).join('\n');
      careCountersJson = JSON.stringify(loadedPrefs.command_center.care_categories?.counters || [], null, 2);
      corsOrigins = (loadedPrefs.cors.origins || []).join('\n');
    } catch (e) {
      prefs = null;
      error = e instanceof Error ? e.message : 'Failed to load preferences';
    } finally {
      loading = false;
    }
  }

  async function savePrefs() {
    saving = true;
    message = null;
    error = null;
    try {
      const updates: Record<string, unknown> = {
        identity: {
          companion_name: companionName,
          user_name: userName,
          timezone,
          profile_path: identityProfilePath,
          companion_md_path: identityNarrativePath,
          provider_overrides_path: identityOverridesPath,
          profile_yaml: identityProfileYaml,
          companion_markdown: identityNarrative,
          provider_overrides: {
            claude_code: claudeRuntimeNotes,
            openai_codex: codexRuntimeNotes,
            openrouter: openRouterRuntimeNotes,
          },
        },
        agent: {
          provider,
          autonomous_provider: autonomousProvider,
          model,
          model_autonomous: modelAutonomous,
          openai_codex_permission: codexPermission,
          openrouter: {
            base_url: openRouterBaseUrl,
            api_key_env: openRouterApiKeyEnv,
            default_model: openRouterDefaultModel,
            api_key: openRouterApiKey || undefined,
            clear_api_key: clearOpenRouterApiKey,
          },
        },
        scribe: {
          enabled: scribeEnabled,
          provider: scribeProvider,
          model: scribeModel,
          interval_minutes: scribeIntervalMinutes,
          digest_path: scribeDigestPath,
          min_messages: scribeMinMessages,
        },
        hooks: {
          context_injection: contextInjection,
          safe_write_prefixes: safeWritePrefixes.split(/\r?\n|,/).map(s => s.trim()).filter(Boolean),
        },
        orchestrator: { enabled: orchestratorEnabled, wake_prompts_path: wakePromptsPath },
        voice: { enabled: voiceEnabled, elevenlabs_voice_id: elevenlabsVoiceId },
        discord: { enabled: discordEnabled, owner_user_id: discordOwnerUserId },
        telegram: { enabled: telegramEnabled, owner_chat_id: telegramOwnerChatId },
        integrations: {
          life_api_url: lifeApiUrl,
          mind_cloud: { enabled: mindCloudEnabled, mcp_url: mindCloudMcpUrl },
        },
        command_center: {
          enabled: commandCenterEnabled,
          default_person: commandCenterDefaultPerson,
          currency_symbol: currencySymbol,
          care_categories: {
            toggles: careToggles.split(/\r?\n|,/).map(s => s.trim()).filter(Boolean),
            ratings: careRatings.split(/\r?\n|,/).map(s => s.trim()).filter(Boolean),
            counters: JSON.parse(careCountersJson || '[]'),
          },
        },
        cors: { origins: corsOrigins.split(/\r?\n|,/).map(s => s.trim()).filter(Boolean) },
      };
      if (newPassword) {
        updates.auth = { password: newPassword };
      }
      const res = await fetch('/api/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (res.ok) {
        message = data.message || 'Saved';
        newPassword = '';
        openRouterApiKeySet = clearOpenRouterApiKey ? false : openRouterApiKeySet || !!openRouterApiKey;
        openRouterApiKey = '';
        clearOpenRouterApiKey = false;
      } else {
        error = data.error || 'Failed to save';
      }
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to save preferences';
    } finally {
      saving = false;
    }
  }

  onMount(loadPrefs);
</script>

<div class="prefs-panel">
  <datalist id="runtime-model-options">
    {#each MODELS as m}
      <option value={m.id}>{m.label}</option>
    {/each}
  </datalist>

  {#if loading}
    <p class="loading-text">Loading preferences...</p>
  {:else if prefs}
    <!-- Identity -->
    <section class="section">
      <h3 class="section-title">Identity</h3>
      <p class="section-desc">Names and timezone used throughout the system.</p>

      <div class="field">
        <label class="field-label" for="pref-companion">Companion Name</label>
        <input id="pref-companion" type="text" class="field-input" bind:value={companionName} placeholder="Echo" />
      </div>

      <div class="field">
        <label class="field-label" for="pref-user">Your Name</label>
        <input id="pref-user" type="text" class="field-input" bind:value={userName} placeholder="Alex" />
      </div>

      <div class="field">
        <label class="field-label" for="pref-tz">Timezone</label>
        <select id="pref-tz" class="field-select" bind:value={timezone}>
          {#each COMMON_TIMEZONES as tz}
            <option value={tz}>{tz}</option>
          {/each}
          {#if !COMMON_TIMEZONES.includes(timezone)}
            <option value={timezone}>{timezone}</option>
          {/if}
        </select>
      </div>

      <div class="field">
        <label class="field-label" for="pref-identity-profile-path">Identity Profile Path</label>
        <input id="pref-identity-profile-path" type="text" class="field-input" bind:value={identityProfilePath} />
      </div>

      <div class="field">
        <label class="field-label" for="pref-identity-narrative-path">Identity Narrative Path</label>
        <input id="pref-identity-narrative-path" type="text" class="field-input" bind:value={identityNarrativePath} />
      </div>

      <div class="field">
        <label class="field-label" for="pref-identity-overrides-path">Provider Notes Path</label>
        <input id="pref-identity-overrides-path" type="text" class="field-input" bind:value={identityOverridesPath} />
      </div>

      <div class="field">
        <label class="field-label" for="pref-identity-profile">Canonical Profile YAML</label>
        <textarea id="pref-identity-profile" class="field-textarea code-textarea" rows="12" bind:value={identityProfileYaml}></textarea>
      </div>

      <div class="field">
        <label class="field-label" for="pref-identity-narrative">Companion Narrative</label>
        <textarea id="pref-identity-narrative" class="field-textarea code-textarea" rows="10" bind:value={identityNarrative}></textarea>
      </div>

      <details class="details-block">
        <summary>Provider runtime notes</summary>
        <div class="field">
          <label class="field-label" for="pref-claude-notes">Claude Code Notes</label>
          <textarea id="pref-claude-notes" class="field-textarea code-textarea" rows="6" bind:value={claudeRuntimeNotes}></textarea>
        </div>
        <div class="field">
          <label class="field-label" for="pref-codex-notes">OpenAI Codex Notes</label>
          <textarea id="pref-codex-notes" class="field-textarea code-textarea" rows="6" bind:value={codexRuntimeNotes}></textarea>
        </div>
        <div class="field">
          <label class="field-label" for="pref-openrouter-notes">OpenRouter Notes</label>
          <textarea id="pref-openrouter-notes" class="field-textarea code-textarea" rows="6" bind:value={openRouterRuntimeNotes}></textarea>
        </div>
      </details>
    </section>

    <!-- Agent Models -->
    <section class="section">
      <h3 class="section-title">Agent Runtime</h3>
      <p class="section-desc">Provider and model for interactive and autonomous messages.</p>

      <div class="field">
        <label class="field-label" for="pref-provider">Interactive Provider</label>
        <select id="pref-provider" class="field-select" bind:value={provider}>
          {#each PROVIDERS as p}
            <option value={p.id}>{p.label}</option>
          {/each}
        </select>
      </div>

      <div class="field">
        <label class="field-label" for="pref-model">Interactive Model</label>
        <input id="pref-model" type="text" class="field-input" list="runtime-model-options" bind:value={model} />
        <span class="field-hint">Used when you send a message</span>
      </div>

      <div class="field">
        <label class="field-label" for="pref-provider-auto">Autonomous Provider</label>
        <select id="pref-provider-auto" class="field-select" bind:value={autonomousProvider}>
          {#each PROVIDERS as p}
            <option value={p.id}>{p.label}</option>
          {/each}
        </select>
      </div>

      <div class="field">
        <label class="field-label" for="pref-model-auto">Autonomous Model</label>
        <input id="pref-model-auto" type="text" class="field-input" list="runtime-model-options" bind:value={modelAutonomous} />
        <span class="field-hint">Used for scheduled wakes and autonomous actions</span>
      </div>

      <div class="field">
        <label class="field-label" for="pref-codex-permission">Codex Permission</label>
        <select id="pref-codex-permission" class="field-select" bind:value={codexPermission}>
          <option value="workspace-write">Workspace write</option>
          <option value="read-only">Read only</option>
          <option value="danger-full-access">Danger full access</option>
        </select>
        <span class="field-hint">Applies to OpenAI Codex subscription runtime</span>
      </div>

      <div class="field-group">
        <h4 class="group-title">OpenRouter</h4>

        <div class="field">
          <label class="field-label" for="pref-openrouter-base-url">Base URL</label>
          <input id="pref-openrouter-base-url" type="text" class="field-input" bind:value={openRouterBaseUrl} />
        </div>

        <div class="field">
          <label class="field-label" for="pref-openrouter-default-model">Default Model</label>
          <input id="pref-openrouter-default-model" type="text" class="field-input" bind:value={openRouterDefaultModel} placeholder="anthropic/claude-sonnet-4.5" />
        </div>

        <div class="field">
          <label class="field-label" for="pref-openrouter-api-key-env">API Key Environment Name</label>
          <input id="pref-openrouter-api-key-env" type="text" class="field-input" bind:value={openRouterApiKeyEnv} />
        </div>

        <div class="field">
          <label class="field-label" for="pref-openrouter-api-key">
            OpenRouter API Key {openRouterApiKeySet ? '(stored)' : '(not stored)'}
          </label>
          <input id="pref-openrouter-api-key" type="password" class="field-input" bind:value={openRouterApiKey} placeholder="Leave blank to keep unchanged" autocomplete="off" />
        </div>

        {#if openRouterApiKeySet}
          <label class="toggle-row compact">
            <input type="checkbox" bind:checked={clearOpenRouterApiKey} />
            <span class="toggle-label">Clear Key</span>
            <span class="toggle-desc">Remove the key stored in resonant.yaml</span>
          </label>
        {/if}
      </div>
    </section>

    <!-- Scribe -->
    <section class="section">
      <h3 class="section-title">Scribe</h3>
      <p class="section-desc">Periodic digest agent for conversation records.</p>

      <label class="toggle-row">
        <input type="checkbox" bind:checked={scribeEnabled} />
        <span class="toggle-label">Enabled</span>
        <span class="toggle-desc">Run periodic digest passes over new messages</span>
      </label>

      <div class="field">
        <label class="field-label" for="pref-scribe-provider">Provider</label>
        <select id="pref-scribe-provider" class="field-select" bind:value={scribeProvider}>
          {#each PROVIDERS as p}
            <option value={p.id}>{p.label}</option>
          {/each}
        </select>
      </div>

      <div class="field">
        <label class="field-label" for="pref-scribe-model">Model</label>
        <input id="pref-scribe-model" type="text" class="field-input" list="runtime-model-options" bind:value={scribeModel} />
        <span class="field-hint">Uses the same provider runtime contract as chat</span>
      </div>

      <div class="field">
        <label class="field-label" for="pref-scribe-interval">Interval Minutes</label>
        <input id="pref-scribe-interval" type="number" min="1" class="field-input" bind:value={scribeIntervalMinutes} />
      </div>

      <div class="field">
        <label class="field-label" for="pref-scribe-min-messages">Minimum New Messages</label>
        <input id="pref-scribe-min-messages" type="number" min="1" class="field-input" bind:value={scribeMinMessages} />
      </div>

      <div class="field">
        <label class="field-label" for="pref-scribe-digest-path">Digest Folder Path</label>
        <input id="pref-scribe-digest-path" type="text" class="field-input" bind:value={scribeDigestPath} />
        <span class="field-hint">Daily digest markdown files are written here</span>
      </div>
    </section>

    <!-- Toggles -->
    <section class="section">
      <h3 class="section-title">Features</h3>
      <p class="section-desc">Enable or disable system features.</p>

      <label class="toggle-row">
        <input type="checkbox" bind:checked={orchestratorEnabled} />
        <span class="toggle-label">Orchestrator</span>
        <span class="toggle-desc">Scheduled wake-ups and autonomous actions</span>
      </label>

      <div class="field">
        <label class="field-label" for="pref-wake-prompts-path">Wake Prompts Path</label>
        <input id="pref-wake-prompts-path" type="text" class="field-input" bind:value={wakePromptsPath} />
      </div>

      <label class="toggle-row">
        <input type="checkbox" bind:checked={voiceEnabled} />
        <span class="toggle-label">Voice</span>
        <span class="toggle-desc">ElevenLabs TTS and Groq transcription</span>
      </label>
      <div class="field">
        <label class="field-label" for="pref-elevenlabs-voice-id">ElevenLabs Voice ID</label>
        <input id="pref-elevenlabs-voice-id" type="text" class="field-input" bind:value={elevenlabsVoiceId} />
      </div>
      {#if voiceEnabled}
        <div class="setup-guide">
          <p class="guide-title">Voice Setup</p>
          <ol class="guide-steps">
            <li>Get an API key from <strong>ElevenLabs</strong> — <a href="https://elevenlabs.io" target="_blank" rel="noopener">elevenlabs.io</a> → Profile → API Keys</li>
            <li>Create or choose a voice, copy the <strong>Voice ID</strong> from the voice settings</li>
            <li>For transcription, get a <strong>Groq</strong> API key — <a href="https://console.groq.com" target="_blank" rel="noopener">console.groq.com</a> → API Keys</li>
            <li>Add to your <code>.env</code> file:
              <pre class="guide-code">ELEVENLABS_API_KEY=your_key_here
ELEVENLABS_VOICE_ID=your_voice_id
GROQ_API_KEY=your_groq_key</pre>
            </li>
            <li>Restart the server</li>
          </ol>
        </div>
      {/if}

      <label class="toggle-row">
        <input type="checkbox" bind:checked={discordEnabled} />
        <span class="toggle-label">Discord</span>
        <span class="toggle-desc">Discord bot gateway integration</span>
      </label>
      <div class="field">
        <label class="field-label" for="pref-discord-owner-id">Discord Owner User ID</label>
        <input id="pref-discord-owner-id" type="text" class="field-input" bind:value={discordOwnerUserId} />
      </div>
      {#if discordEnabled}
        <div class="setup-guide">
          <p class="guide-title">Discord Setup</p>
          <ol class="guide-steps">
            <li>Go to the <a href="https://discord.com/developers/applications" target="_blank" rel="noopener">Discord Developer Portal</a></li>
            <li>Create a <strong>New Application</strong>, then go to <strong>Bot</strong> → Reset Token → copy the token</li>
            <li>Under <strong>Privileged Gateway Intents</strong>, enable: Message Content, Server Members, Presence</li>
            <li>Go to <strong>OAuth2</strong> → URL Generator → select <code>bot</code> scope with permissions: Send Messages, Read Message History, Add Reactions, Embed Links, Attach Files</li>
            <li>Use the generated URL to invite the bot to your server</li>
            <li>Right-click your username in Discord → Copy User ID (enable Developer Mode in Discord settings first)</li>
            <li>Add to your <code>.env</code> file:
              <pre class="guide-code">DISCORD_BOT_TOKEN=your_bot_token</pre>
            </li>
            <li>Set your owner user ID in <code>resonant.yaml</code>:
              <pre class="guide-code">discord:
  enabled: true
  owner_user_id: "your_discord_user_id"</pre>
            </li>
            <li>Restart the server. Configure rules in the Discord tab in settings.</li>
          </ol>
        </div>
      {/if}

      <label class="toggle-row">
        <input type="checkbox" bind:checked={telegramEnabled} />
        <span class="toggle-label">Telegram</span>
        <span class="toggle-desc">Telegram bot integration</span>
      </label>
      <div class="field">
        <label class="field-label" for="pref-telegram-owner-chat-id">Telegram Owner Chat ID</label>
        <input id="pref-telegram-owner-chat-id" type="text" class="field-input" bind:value={telegramOwnerChatId} />
      </div>
      {#if telegramEnabled}
        <div class="setup-guide">
          <p class="guide-title">Telegram Setup</p>
          <ol class="guide-steps">
            <li>Open Telegram, search for <strong>@BotFather</strong></li>
            <li>Send <code>/newbot</code>, follow the prompts to name your bot</li>
            <li>Copy the <strong>bot token</strong> BotFather gives you</li>
            <li>Send a message to your new bot, then visit:<br/>
              <code>https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</code><br/>
              Find your <strong>chat ID</strong> in the response JSON under <code>message.chat.id</code></li>
            <li>Add to your <code>.env</code> file:
              <pre class="guide-code">TELEGRAM_BOT_TOKEN=your_bot_token</pre>
            </li>
            <li>Set your chat ID in <code>resonant.yaml</code>:
              <pre class="guide-code">telegram:
  enabled: true
  owner_chat_id: "your_chat_id"</pre>
            </li>
            <li>Restart the server</li>
          </ol>
        </div>
      {/if}
    </section>

    <!-- System Surfaces -->
    <section class="section">
      <h3 class="section-title">System Surfaces</h3>
      <p class="section-desc">Runtime-adjacent configuration exposed for advanced installs.</p>

      <label class="toggle-row">
        <input type="checkbox" bind:checked={contextInjection} />
        <span class="toggle-label">Context</span>
        <span class="toggle-desc">Inject orientation context into companion runs</span>
      </label>

      <div class="field">
        <label class="field-label" for="pref-safe-write-prefixes">Safe Write Prefixes</label>
        <textarea id="pref-safe-write-prefixes" class="field-textarea code-textarea" rows="4" bind:value={safeWritePrefixes}></textarea>
        <span class="field-hint">One path per line or comma-separated</span>
      </div>

      <div class="field">
        <label class="field-label" for="pref-life-api-url">Life API URL</label>
        <input id="pref-life-api-url" type="text" class="field-input" bind:value={lifeApiUrl} />
      </div>

      <label class="toggle-row">
        <input type="checkbox" bind:checked={mindCloudEnabled} />
        <span class="toggle-label">Mind Cloud</span>
        <span class="toggle-desc">Enable Mind Cloud integration metadata</span>
      </label>

      <div class="field">
        <label class="field-label" for="pref-mind-cloud-mcp-url">Mind Cloud MCP URL</label>
        <input id="pref-mind-cloud-mcp-url" type="text" class="field-input" bind:value={mindCloudMcpUrl} />
      </div>

      <label class="toggle-row">
        <input type="checkbox" bind:checked={commandCenterEnabled} />
        <span class="toggle-label">Command Center</span>
        <span class="toggle-desc">Enable life-management pages and tools</span>
      </label>

      <div class="field">
        <label class="field-label" for="pref-cc-default-person">Default Person</label>
        <input id="pref-cc-default-person" type="text" class="field-input" bind:value={commandCenterDefaultPerson} />
      </div>

      <div class="field">
        <label class="field-label" for="pref-currency-symbol">Currency Symbol</label>
        <input id="pref-currency-symbol" type="text" class="field-input" bind:value={currencySymbol} />
      </div>

      <details class="details-block">
        <summary>Care categories</summary>
        <div class="field">
          <label class="field-label" for="pref-care-toggles">Care Toggles</label>
          <textarea id="pref-care-toggles" class="field-textarea code-textarea" rows="4" bind:value={careToggles}></textarea>
        </div>
        <div class="field">
          <label class="field-label" for="pref-care-ratings">Care Ratings</label>
          <textarea id="pref-care-ratings" class="field-textarea code-textarea" rows="4" bind:value={careRatings}></textarea>
        </div>
        <div class="field">
          <label class="field-label" for="pref-care-counters">Care Counters JSON</label>
          <textarea id="pref-care-counters" class="field-textarea code-textarea" rows="6" bind:value={careCountersJson}></textarea>
        </div>
      </details>

      <div class="field">
        <label class="field-label" for="pref-cors-origins">CORS Origins</label>
        <textarea id="pref-cors-origins" class="field-textarea code-textarea" rows="4" bind:value={corsOrigins}></textarea>
        <span class="field-hint">One origin per line or comma-separated</span>
      </div>
    </section>

    <!-- Security -->
    <section class="section">
      <h3 class="section-title">Security</h3>
      <p class="section-desc">
        {#if prefs.auth.has_password}
          Password is set. Leave blank to keep current password.
        {:else}
          No password set. Access is open to anyone on the network.
        {/if}
      </p>

      <div class="field">
        <label class="field-label" for="pref-password">
          {prefs.auth.has_password ? 'Change Password' : 'Set Password'}
        </label>
        <input id="pref-password" type="password" class="field-input" bind:value={newPassword} placeholder="Leave blank to keep unchanged" />
      </div>
    </section>

    <!-- Save -->
    <div class="save-area">
      {#if message}
        <p class="save-message success">{message}</p>
      {/if}
      {#if error}
        <p class="save-message error">{error}</p>
      {/if}
      <button class="save-btn" onclick={savePrefs} disabled={saving}>
        {saving ? 'Saving...' : 'Save Preferences'}
      </button>
      <p class="save-hint">Some changes require a server restart to take effect.</p>
    </div>
  {:else}
    <div class="error-state">
      <p class="error-title">Preferences unavailable</p>
      <p class="error-text">{error || 'Unable to load preferences'}</p>
      <button class="retry-btn" onclick={loadPrefs}>Retry</button>
    </div>
  {/if}
</div>

<style>
  .prefs-panel {
    max-width: 540px;
  }

  .loading-text {
    color: var(--text-muted);
    font-size: 0.875rem;
    font-style: italic;
    padding: 1rem 0;
  }

  .error-state {
    padding: 1rem;
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-left: 2px solid #e05252;
    border-radius: 6px;
  }

  .error-title {
    font-family: var(--font-heading);
    font-size: 0.875rem;
    color: #e05252;
    margin: 0 0 0.375rem;
  }

  .error-text {
    font-size: 0.8125rem;
    color: var(--text-secondary);
    margin: 0 0 0.875rem;
    line-height: 1.5;
  }

  .retry-btn {
    padding: 0.5rem 1rem;
    font-size: 0.8125rem;
    font-family: var(--font-heading);
    color: var(--text-primary);
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 6px;
    cursor: pointer;
  }

  .retry-btn:hover {
    border-color: var(--gold-dim);
  }

  .section {
    margin-bottom: 2rem;
    padding-bottom: 1.5rem;
    border-bottom: 1px solid var(--border);
  }

  .section:last-of-type {
    border-bottom: none;
  }

  .section-title {
    font-family: var(--font-heading);
    font-size: 0.9375rem;
    font-weight: 400;
    color: var(--text-accent);
    letter-spacing: 0.04em;
    margin: 0 0 0.375rem;
  }

  .section-desc {
    font-size: 0.8125rem;
    color: var(--text-muted);
    margin: 0 0 1rem;
    line-height: 1.5;
  }

  .field {
    margin-bottom: 1rem;
  }

  .field-label {
    display: block;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    margin-bottom: 0.375rem;
    letter-spacing: 0.02em;
  }

  .field-input,
  .field-select,
  .field-textarea {
    width: 100%;
    padding: 0.5rem 0.75rem;
    font-size: 0.875rem;
    font-family: inherit;
    color: var(--text-primary);
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 6px;
    transition: border-color var(--transition), box-shadow var(--transition);
  }

  .field-input:focus,
  .field-select:focus,
  .field-textarea:focus {
    outline: none;
    border-color: var(--gold-dim);
    box-shadow: 0 0 0 2px rgba(196, 168, 114, 0.08);
  }

  .field-textarea {
    min-height: 8rem;
    resize: vertical;
    line-height: 1.55;
  }

  .code-textarea {
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: 0.75rem;
  }

  .field-hint {
    display: block;
    font-size: 0.75rem;
    color: var(--text-muted);
    margin-top: 0.25rem;
  }

  .details-block {
    margin: 1rem 0 0;
    padding: 0.875rem 1rem 0.125rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-input);
  }

  .details-block summary {
    margin-bottom: 0.875rem;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 0.8125rem;
  }

  .field-group {
    margin-top: 1.25rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border);
  }

  .group-title {
    font-family: var(--font-heading);
    font-size: 0.8125rem;
    font-weight: 400;
    color: var(--text-accent);
    letter-spacing: 0.04em;
    margin: 0 0 0.875rem;
  }

  .toggle-row {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.75rem 0;
    cursor: pointer;
    border-bottom: 1px solid var(--border);
  }

  .toggle-row.compact {
    border-bottom: none;
    padding: 0.25rem 0 0;
  }

  .toggle-row:last-of-type {
    border-bottom: none;
  }

  .toggle-row input[type="checkbox"] {
    margin-top: 0.125rem;
    width: 1rem;
    height: 1rem;
    accent-color: var(--gold);
    flex-shrink: 0;
  }

  .toggle-label {
    font-size: 0.875rem;
    color: var(--text-primary);
    min-width: 5rem;
    flex-shrink: 0;
  }

  .toggle-desc {
    font-size: 0.8125rem;
    color: var(--text-muted);
    flex: 1;
  }

  .save-area {
    padding-top: 0.5rem;
  }

  .save-btn {
    padding: 0.625rem 1.5rem;
    font-size: 0.875rem;
    font-family: var(--font-heading);
    letter-spacing: 0.04em;
    color: var(--bg-primary);
    background: var(--gold);
    border: none;
    border-radius: 6px;
    cursor: pointer;
    transition: opacity var(--transition);
  }

  .save-btn:hover {
    opacity: 0.9;
  }

  .save-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .save-message {
    font-size: 0.8125rem;
    padding: 0.5rem 0;
    margin: 0;
  }

  .save-message.success {
    color: var(--gold);
  }

  .save-message.error {
    color: #e05252;
  }

  .save-hint {
    font-size: 0.75rem;
    color: var(--text-muted);
    margin-top: 0.5rem;
  }

  .setup-guide {
    margin: 0.5rem 0 1rem 1.75rem;
    padding: 1rem;
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-left: 2px solid var(--gold-dim);
    border-radius: 6px;
  }

  .guide-title {
    font-family: var(--font-heading);
    font-size: 0.8125rem;
    font-weight: 400;
    color: var(--text-accent);
    letter-spacing: 0.04em;
    margin: 0 0 0.75rem;
  }

  .guide-steps {
    margin: 0;
    padding-left: 1.25rem;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    line-height: 1.7;
  }

  .guide-steps li {
    margin-bottom: 0.5rem;
  }

  .guide-steps a {
    color: var(--gold);
    text-decoration: none;
    border-bottom: 1px solid var(--gold-dim);
  }

  .guide-steps a:hover {
    border-bottom-color: var(--gold);
  }

  .guide-steps code {
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: 0.75rem;
    padding: 0.125rem 0.375rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 3px;
    color: var(--gold);
  }

  .guide-code {
    display: block;
    margin: 0.5rem 0;
    padding: 0.625rem 0.75rem;
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: 0.75rem;
    line-height: 1.6;
    color: var(--text-secondary);
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 4px;
    overflow-x: auto;
    white-space: pre;
  }
</style>
