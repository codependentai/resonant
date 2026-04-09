<script lang="ts">
  import { onMount } from 'svelte';

  interface DiscordStatus {
    enabled: boolean;
    configEnabled: boolean;
    hasToken: boolean;
    connected: boolean;
    username: string | null;
    guilds: number;
    messagesReceived: number;
    messagesProcessed: number;
    deferred: number;
    deferredPending: number;
    errors: number;
  }

  interface PairingEntry {
    code: string;
    userId: string;
    username: string | null;
    channelId: string;
    createdAt: string;
    expiresAt: string;
    approvedAt?: string;
    approvedBy?: string;
  }

  interface DiscordSettings {
    maryUserId: string;
    requireMentionInGuilds: boolean;
    debounceMs: number;
    pairingExpiryMs: number;
    maryActiveThresholdMin: number;
    deferPollIntervalMs: number;
    deferMaxAgeMs: number;
    allowedUsers: string[];
    allowedGuilds: string[];
    activeChannels: string[];
  }

  interface ServerRule {
    id: string;
    name: string;
    context: string;
    requireMention?: boolean;
    ignoredChannels?: string[];
    ignoredUsers?: string[];
    allowPublicResponses?: boolean;
  }

  interface ChannelRule {
    id: string;
    name: string;
    serverId: string;
    context?: string;
    requireMention?: boolean;
    alwaysListen?: boolean;
    ignore?: boolean;
    readOnly?: boolean;
  }

  interface UserRule {
    id: string;
    name: string;
    context?: string;
    allowedServers?: string[];
    blockedServers?: string[];
    trustLevel: 'full' | 'standard' | 'limited';
    relationship?: string;
  }

  interface RulesData {
    servers: Record<string, ServerRule>;
    channels: Record<string, ChannelRule>;
    users: Record<string, UserRule>;
  }

  let loading = $state(true);
  let error = $state<string | null>(null);
  let statusMessage = $state<string | null>(null);
  let discordStatus = $state<DiscordStatus | null>(null);
  let pendingPairings = $state<PairingEntry[]>([]);
  let approvedPairings = $state<PairingEntry[]>([]);
  let actionLoading = $state<string | null>(null);
  let toggling = $state(false);

  // Settings state
  let settings = $state<DiscordSettings | null>(null);
  let settingsLoading = $state(false);
  let settingsDirty = $state(false);

  // Rules state
  let rules = $state<RulesData | null>(null);
  let rulesLoading = $state(false);
  let expandedRules = $state<Set<string>>(new Set());

  // Activity log state
  interface LogEntry {
    timestamp: string;
    level: 'info' | 'warn' | 'error';
    event: string;
    detail?: string;
  }
  let activityLogs = $state<LogEntry[]>([]);
  let logsLoading = $state(false);
  let showLogs = $state(false);
  let logsTimer: ReturnType<typeof setInterval> | null = null;

  // Section collapse state
  let showSettings = $state(false);
  let showRules = $state(false);
  let rulesSection = $state<'servers' | 'channels' | 'users'>('servers');

  // Add rule form state
  let addingRule = $state<string | null>(null);
  let newRuleId = $state('');
  let newRuleName = $state('');

  let isEnabled = $derived(discordStatus?.enabled ?? false);

  async function loadData() {
    try {
      const [statusRes, pairingsRes] = await Promise.all([
        fetch('/api/discord/status'),
        fetch('/api/discord/pairings'),
      ]);

      if (statusRes.ok) {
        discordStatus = await statusRes.json();
      }

      if (pairingsRes.ok) {
        const data = await pairingsRes.json();
        pendingPairings = data.pending || [];
        approvedPairings = data.approved || [];
      }
    } catch {
      error = 'Failed to load Discord status';
    } finally {
      loading = false;
    }
  }

  async function loadLogs() {
    logsLoading = true;
    try {
      const res = await fetch('/api/discord/logs?limit=100');
      if (res.ok) {
        activityLogs = await res.json();
      }
    } catch {
      // silent — non-critical
    } finally {
      logsLoading = false;
    }
  }

  function toggleLogs() {
    showLogs = !showLogs;
    if (showLogs) {
      loadLogs();
      logsTimer = setInterval(loadLogs, 10000);
    } else if (logsTimer) {
      clearInterval(logsTimer);
      logsTimer = null;
    }
  }

  function formatLogTime(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function formatLogDate(iso: string): string {
    const d = new Date(iso);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return 'Today';
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  async function loadSettings() {
    settingsLoading = true;
    try {
      const res = await fetch('/api/discord/settings');
      if (res.ok) {
        settings = await res.json();
        settingsDirty = false;
      }
    } catch {
      error = 'Failed to load Discord settings';
    } finally {
      settingsLoading = false;
    }
  }

  async function saveSettings() {
    if (!settings) return;
    settingsLoading = true;
    error = null;
    try {
      const res = await fetch('/api/discord/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Save failed');
      }
      const data = await res.json();
      settings = data;
      settingsDirty = false;
      statusMessage = 'Settings saved';
      setTimeout(() => statusMessage = null, 3000);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to save settings';
    } finally {
      settingsLoading = false;
    }
  }

  async function loadRules() {
    rulesLoading = true;
    try {
      const res = await fetch('/api/discord/rules');
      if (res.ok) {
        rules = await res.json();
      }
    } catch {
      error = 'Failed to load Discord rules';
    } finally {
      rulesLoading = false;
    }
  }

  async function saveRule(type: 'server' | 'channel' | 'user', rule: ServerRule | ChannelRule | UserRule) {
    actionLoading = `save-${type}-${rule.id}`;
    error = null;
    try {
      const res = await fetch(`/api/discord/rules/${type}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rule),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Save failed');
      }
      statusMessage = `${type.charAt(0).toUpperCase() + type.slice(1)} rule saved`;
      setTimeout(() => statusMessage = null, 3000);
      await loadRules();
    } catch (err) {
      error = err instanceof Error ? err.message : `Failed to save ${type} rule`;
    } finally {
      actionLoading = null;
    }
  }

  async function deleteRule(type: 'server' | 'channel' | 'user', id: string) {
    actionLoading = `delete-${type}-${id}`;
    error = null;
    try {
      const res = await fetch(`/api/discord/rules/${type}/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Delete failed');
      }
      statusMessage = `${type.charAt(0).toUpperCase() + type.slice(1)} rule deleted`;
      setTimeout(() => statusMessage = null, 3000);
      expandedRules.delete(`${type}-${id}`);
      expandedRules = new Set(expandedRules);
      await loadRules();
    } catch (err) {
      error = err instanceof Error ? err.message : `Failed to delete ${type} rule`;
    } finally {
      actionLoading = null;
    }
  }

  function toggleRule(key: string) {
    if (expandedRules.has(key)) {
      expandedRules.delete(key);
    } else {
      expandedRules.add(key);
    }
    expandedRules = new Set(expandedRules);
  }

  function startAddRule(type: string) {
    addingRule = type;
    newRuleId = '';
    newRuleName = '';
  }

  function cancelAddRule() {
    addingRule = null;
    newRuleId = '';
    newRuleName = '';
  }

  async function confirmAddRule() {
    if (!newRuleId || !newRuleName || !addingRule) return;
    const type = addingRule;

    let rule: ServerRule | ChannelRule | UserRule;
    if (type === 'server') {
      rule = { id: newRuleId, name: newRuleName, context: '', requireMention: true } as ServerRule;
    } else if (type === 'channel') {
      rule = { id: newRuleId, name: newRuleName, serverId: '' } as ChannelRule;
    } else {
      rule = { id: newRuleId, name: newRuleName, trustLevel: 'standard' as const } as UserRule;
    }

    await saveRule(type as 'server' | 'channel' | 'user', rule);
    expandedRules.add(`${type}-${newRuleId}`);
    expandedRules = new Set(expandedRules);
    cancelAddRule();
  }

  async function toggleDiscord() {
    toggling = true;
    error = null;
    const newState = !isEnabled;
    try {
      const res = await fetch('/api/discord/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: newState }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Toggle failed');
      }
      statusMessage = newState ? 'Discord gateway starting...' : 'Discord gateway stopped';
      setTimeout(() => statusMessage = null, 3000);
      if (newState) {
        await new Promise(r => setTimeout(r, 2000));
      }
      await loadData();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to toggle Discord';
    } finally {
      toggling = false;
    }
  }

  async function approvePairing(code: string) {
    actionLoading = `approve-${code}`;
    error = null;
    try {
      const res = await fetch(`/api/discord/pairings/${code}/approve`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Approval failed');
      }
      statusMessage = 'Pairing approved';
      setTimeout(() => statusMessage = null, 3000);
      await loadData();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to approve';
    } finally {
      actionLoading = null;
    }
  }

  async function revokePairing(userId: string) {
    actionLoading = `revoke-${userId}`;
    error = null;
    try {
      const res = await fetch(`/api/discord/pairings/${userId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Revocation failed');
      }
      statusMessage = 'Access revoked';
      setTimeout(() => statusMessage = null, 3000);
      await loadData();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to revoke';
    } finally {
      actionLoading = null;
    }
  }

  onMount(() => {
    loadData();
  });
</script>

<div class="discord-panel">
  {#if loading}
    <p class="loading">Loading Discord status...</p>
  {:else}
    <!-- Gateway Toggle -->
    <section class="section">
      <h3 class="section-title">Discord Gateway</h3>
      {#if !discordStatus?.hasToken}
        <p class="help-text warning">No bot token configured. Add <code>DISCORD_BOT_TOKEN</code> to .env and restart.</p>
      {:else}
        <div class="toggle-row">
          <div class="toggle-label">
            <span class="toggle-text">{isEnabled ? 'Gateway active' : 'Gateway off'}</span>
            <span class="toggle-desc">Connect to Discord and receive messages</span>
          </div>
          <button
            class="toggle-switch"
            class:on={isEnabled}
            onclick={toggleDiscord}
            disabled={toggling}
            aria-label={isEnabled ? 'Disable Discord' : 'Enable Discord'}
          >
            <span class="toggle-knob"></span>
          </button>
        </div>
      {/if}
    </section>

    <!-- Connection Status (only when enabled) -->
    {#if isEnabled}
      <section class="section">
        <h3 class="section-title">Connection</h3>
        <div class="status-row">
          <span class="status-dot" class:connected={discordStatus?.connected} class:offline={!discordStatus?.connected}></span>
          {#if discordStatus?.connected}
            <span class="status-text connected">
              Online as <strong>{discordStatus.username}</strong>
            </span>
          {:else}
            <span class="status-text offline">Connecting...</span>
          {/if}
        </div>

        {#if discordStatus?.connected}
          <div class="stats-grid">
            <div class="stat-card">
              <span class="stat-label">Guilds</span>
              <span class="stat-value">{discordStatus.guilds}</span>
            </div>
            <div class="stat-card">
              <span class="stat-label">Received</span>
              <span class="stat-value">{discordStatus.messagesReceived}</span>
            </div>
            <div class="stat-card">
              <span class="stat-label">Processed</span>
              <span class="stat-value">{discordStatus.messagesProcessed}</span>
            </div>
            <div class="stat-card">
              <span class="stat-label">Deferred</span>
              <span class="stat-value">{discordStatus.deferred ?? 0}</span>
            </div>
            <div class="stat-card">
              <span class="stat-label">Errors</span>
              <span class="stat-value" class:error-count={discordStatus.errors > 0}>{discordStatus.errors}</span>
            </div>
          </div>
          {#if discordStatus.deferredPending > 0}
            <p class="deferred-notice">{discordStatus.deferredPending} message{discordStatus.deferredPending > 1 ? 's' : ''} held — waiting for Pulse conversation gap</p>
          {/if}
        {/if}
      </section>
    {/if}

    <!-- Activity Log -->
    {#if isEnabled}
      <section class="section">
        <button class="collapsible-header" onclick={toggleLogs}>
          <h3 class="section-title">Recent Activity</h3>
          <span class="chevron" class:open={showLogs}>&#9656;</span>
        </button>

        {#if showLogs}
          {#if logsLoading && activityLogs.length === 0}
            <p class="loading">Loading logs...</p>
          {:else if activityLogs.length === 0}
            <p class="section-desc">No activity recorded yet.</p>
          {:else}
            <div class="log-list">
              {#each activityLogs as entry, i}
                {@const prevDate = i > 0 ? formatLogDate(activityLogs[i - 1].timestamp) : null}
                {@const thisDate = formatLogDate(entry.timestamp)}
                {#if thisDate !== prevDate}
                  <div class="log-date-sep">{thisDate}</div>
                {/if}
                <div class="log-entry log-{entry.level}">
                  <span class="log-time">{formatLogTime(entry.timestamp)}</span>
                  <span class="log-level-dot"></span>
                  <span class="log-event">{entry.event}</span>
                  {#if entry.detail}
                    <span class="log-detail">{entry.detail}</span>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        {/if}
      </section>
    {/if}

    <!-- Pending Pairings -->
    {#if pendingPairings.length > 0}
      <section class="section">
        <h3 class="section-title">Pending Pairing Requests</h3>
        <p class="section-desc">Users who sent a pairing code via DM. Approve to allow them to message Simon.</p>
        <div class="pairing-list">
          {#each pendingPairings as pairing}
            <div class="pairing-card">
              <div class="pairing-info">
                <span class="pairing-user">{pairing.username || pairing.userId}</span>
                <span class="pairing-meta">
                  Code: <code>{pairing.code}</code> &middot;
                  Expires {new Date(pairing.expiresAt).toLocaleString()}
                </span>
              </div>
              <button
                class="btn btn-primary"
                onclick={() => approvePairing(pairing.code)}
                disabled={actionLoading === `approve-${pairing.code}`}
              >
                {actionLoading === `approve-${pairing.code}` ? 'Approving...' : 'Approve'}
              </button>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    <!-- Approved Users -->
    {#if approvedPairings.length > 0}
      <section class="section">
        <h3 class="section-title">Approved Users</h3>
        <p class="section-desc">Users who can message Simon via Discord DMs.</p>
        <div class="pairing-list">
          {#each approvedPairings as pairing}
            <div class="pairing-card">
              <div class="pairing-info">
                <span class="pairing-user">{pairing.username || pairing.userId}</span>
                <span class="pairing-meta">
                  Approved {pairing.approvedAt ? new Date(pairing.approvedAt).toLocaleDateString() : 'unknown'}
                </span>
              </div>
              <button
                class="btn btn-danger"
                onclick={() => revokePairing(pairing.userId)}
                disabled={actionLoading === `revoke-${pairing.userId}`}
              >
                {actionLoading === `revoke-${pairing.userId}` ? 'Revoking...' : 'Revoke'}
              </button>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    <!-- Gateway Settings -->
    <section class="section">
      <button class="collapsible-header" onclick={() => { showSettings = !showSettings; if (showSettings && !settings) loadSettings(); }}>
        <h3 class="section-title">Gateway Settings</h3>
        <span class="chevron" class:open={showSettings}>&#9656;</span>
      </button>

      {#if showSettings}
        {#if settingsLoading && !settings}
          <p class="loading">Loading settings...</p>
        {:else if settings}
          <div class="settings-form">
            <label class="form-group">
              <span class="form-label">Debounce window (ms)</span>
              <input type="number" class="form-input" bind:value={settings.debounceMs} onchange={() => settingsDirty = true} />
              <span class="form-hint">Combines rapid messages within this window</span>
            </label>

            <div class="form-group">
              <span class="form-label">Require @mention in guilds</span>
              <div class="toggle-row compact">
                <button
                  class="toggle-switch small"
                  class:on={settings.requireMentionInGuilds}
                  aria-label="Require @mention in guilds"
                  aria-pressed={settings.requireMentionInGuilds}
                  onclick={() => { settings!.requireMentionInGuilds = !settings!.requireMentionInGuilds; settingsDirty = true; }}
                >
                  <span class="toggle-knob"></span>
                </button>
              </div>
            </div>

            <label class="form-group">
              <span class="form-label">Pairing expiry (hours)</span>
              <input type="number" class="form-input" step="0.5"
                value={settings.pairingExpiryMs / 3600000}
                onchange={(e) => { settings!.pairingExpiryMs = parseFloat((e.target as HTMLInputElement).value) * 3600000; settingsDirty = true; }}
              />
            </label>

            <label class="form-group">
              <span class="form-label">Mary active threshold (minutes)</span>
              <input type="number" class="form-input" bind:value={settings.maryActiveThresholdMin} onchange={() => settingsDirty = true} />
              <span class="form-hint">Defer non-Mary messages when she's been active within this window</span>
            </label>

            <label class="form-group">
              <span class="form-label">Defer poll interval (seconds)</span>
              <input type="number" class="form-input"
                value={settings.deferPollIntervalMs / 1000}
                onchange={(e) => { settings!.deferPollIntervalMs = parseFloat((e.target as HTMLInputElement).value) * 1000; settingsDirty = true; }}
              />
              <span class="form-hint">Requires gateway restart to take effect</span>
            </label>

            <label class="form-group">
              <span class="form-label">Defer max age (minutes)</span>
              <input type="number" class="form-input"
                value={settings.deferMaxAgeMs / 60000}
                onchange={(e) => { settings!.deferMaxAgeMs = parseFloat((e.target as HTMLInputElement).value) * 60000; settingsDirty = true; }}
              />
              <span class="form-hint">Drop deferred messages older than this</span>
            </label>

            <label class="form-group">
              <span class="form-label">Allowed guilds (IDs)</span>
              <input type="text" class="form-input"
                value={settings.allowedGuilds.join(', ')}
                onchange={(e) => { settings!.allowedGuilds = (e.target as HTMLInputElement).value.split(',').map(s => s.trim()).filter(Boolean); settingsDirty = true; }}
              />
            </label>

            <label class="form-group">
              <span class="form-label">Active channels (no @mention needed)</span>
              <input type="text" class="form-input"
                value={settings.activeChannels.join(', ')}
                onchange={(e) => { settings!.activeChannels = (e.target as HTMLInputElement).value.split(',').map(s => s.trim()).filter(Boolean); settingsDirty = true; }}
              />
            </label>

            <label class="form-group">
              <span class="form-label">Allowed users (IDs)</span>
              <input type="text" class="form-input"
                value={settings.allowedUsers.join(', ')}
                onchange={(e) => { settings!.allowedUsers = (e.target as HTMLInputElement).value.split(',').map(s => s.trim()).filter(Boolean); settingsDirty = true; }}
              />
            </label>

            {#if settingsDirty}
              <button class="btn btn-primary save-btn" onclick={saveSettings} disabled={settingsLoading}>
                {settingsLoading ? 'Saving...' : 'Save Settings'}
              </button>
            {/if}
          </div>
        {/if}
      {/if}
    </section>

    <!-- Rules Editor -->
    <section class="section">
      <button class="collapsible-header" onclick={() => { showRules = !showRules; if (showRules && !rules) loadRules(); }}>
        <h3 class="section-title">Rules</h3>
        <span class="chevron" class:open={showRules}>&#9656;</span>
      </button>

      {#if showRules}
        {#if rulesLoading && !rules}
          <p class="loading">Loading rules...</p>
        {:else if rules}
          <!-- Rules sub-tabs -->
          <nav class="rules-tabs">
            <button class="rules-tab" class:active={rulesSection === 'servers'} onclick={() => rulesSection = 'servers'}>
              Servers ({Object.keys(rules.servers).length})
            </button>
            <button class="rules-tab" class:active={rulesSection === 'channels'} onclick={() => rulesSection = 'channels'}>
              Channels ({Object.keys(rules.channels).length})
            </button>
            <button class="rules-tab" class:active={rulesSection === 'users'} onclick={() => rulesSection = 'users'}>
              Users ({Object.keys(rules.users).length})
            </button>
          </nav>

          <!-- Server Rules -->
          {#if rulesSection === 'servers'}
            <div class="rules-list">
              {#each Object.values(rules.servers) as rule (rule.id)}
                {@const key = `server-${rule.id}`}
                <div class="rule-card">
                  <button class="rule-header" onclick={() => toggleRule(key)}>
                    <span class="rule-name">{rule.name}</span>
                    <span class="rule-id">{rule.id}</span>
                    <span class="chevron small" class:open={expandedRules.has(key)}>&#9656;</span>
                  </button>
                  {#if expandedRules.has(key)}
                    <div class="rule-body">
                      <label class="form-group">
                        <span class="form-label">Name</span>
                        <input type="text" class="form-input" bind:value={rule.name} />
                      </label>
                      <label class="form-group">
                        <span class="form-label">Context</span>
                        <textarea class="form-textarea" bind:value={rule.context} rows="4"></textarea>
                      </label>
                      <div class="form-group">
                        <span class="form-label">Require @mention</span>
                        <button class="toggle-switch small" class:on={rule.requireMention ?? true} aria-label="Require @mention" aria-pressed={rule.requireMention ?? true} onclick={() => rule.requireMention = !(rule.requireMention ?? true)}>
                          <span class="toggle-knob"></span>
                        </button>
                      </div>
                      <div class="form-group">
                        <span class="form-label">Allow public responses</span>
                        <button class="toggle-switch small" class:on={rule.allowPublicResponses ?? false} aria-label="Allow public responses" aria-pressed={rule.allowPublicResponses ?? false} onclick={() => rule.allowPublicResponses = !(rule.allowPublicResponses ?? false)}>
                          <span class="toggle-knob"></span>
                        </button>
                      </div>
                      <label class="form-group">
                        <span class="form-label">Ignored channels (IDs)</span>
                        <input type="text" class="form-input"
                          value={(rule.ignoredChannels || []).join(', ')}
                          onchange={(e) => rule.ignoredChannels = (e.target as HTMLInputElement).value.split(',').map(s => s.trim()).filter(Boolean)}
                        />
                      </label>
                      <div class="rule-actions">
                        <button class="btn btn-primary" onclick={() => saveRule('server', rule)} disabled={actionLoading === `save-server-${rule.id}`}>
                          {actionLoading === `save-server-${rule.id}` ? 'Saving...' : 'Save'}
                        </button>
                        <button class="btn btn-danger" onclick={() => deleteRule('server', rule.id)} disabled={actionLoading === `delete-server-${rule.id}`}>
                          {actionLoading === `delete-server-${rule.id}` ? 'Deleting...' : 'Delete'}
                        </button>
                      </div>
                    </div>
                  {/if}
                </div>
              {/each}
              {#if addingRule === 'server'}
                <div class="rule-card add-form">
                  <label class="form-group">
                    <span class="form-label">Server ID</span>
                    <input type="text" class="form-input" bind:value={newRuleId} placeholder="Discord server ID" />
                  </label>
                  <label class="form-group">
                    <span class="form-label">Name</span>
                    <input type="text" class="form-input" bind:value={newRuleName} placeholder="Server name" />
                  </label>
                  <div class="rule-actions">
                    <button class="btn btn-primary" onclick={confirmAddRule} disabled={!newRuleId || !newRuleName}>Add</button>
                    <button class="btn btn-muted" onclick={cancelAddRule}>Cancel</button>
                  </div>
                </div>
              {:else}
                <button class="btn btn-muted add-btn" onclick={() => startAddRule('server')}>+ Add server rule</button>
              {/if}
            </div>
          {/if}

          <!-- Channel Rules -->
          {#if rulesSection === 'channels'}
            <div class="rules-list">
              {#each Object.values(rules.channels) as rule (rule.id)}
                {@const key = `channel-${rule.id}`}
                <div class="rule-card">
                  <button class="rule-header" onclick={() => toggleRule(key)}>
                    <span class="rule-name">#{rule.name}</span>
                    <span class="rule-id">{rule.id}</span>
                    <span class="chevron small" class:open={expandedRules.has(key)}>&#9656;</span>
                  </button>
                  {#if expandedRules.has(key)}
                    <div class="rule-body">
                      <label class="form-group">
                        <span class="form-label">Name</span>
                        <input type="text" class="form-input" bind:value={rule.name} />
                      </label>
                      <label class="form-group">
                        <span class="form-label">Server ID</span>
                        <input type="text" class="form-input" bind:value={rule.serverId} />
                      </label>
                      <label class="form-group">
                        <span class="form-label">Context</span>
                        <textarea class="form-textarea" bind:value={rule.context} rows="3"></textarea>
                      </label>
                      <div class="form-group inline-toggles">
                        <div class="toggle-item">
                          <span class="form-label">Require @mention</span>
                          <button class="toggle-switch small" class:on={rule.requireMention ?? false} aria-label="Require @mention" aria-pressed={rule.requireMention ?? false} onclick={() => rule.requireMention = !(rule.requireMention ?? false)}>
                            <span class="toggle-knob"></span>
                          </button>
                        </div>
                        <div class="toggle-item">
                          <span class="form-label">Always listen</span>
                          <button class="toggle-switch small" class:on={rule.alwaysListen ?? false} aria-label="Always listen" aria-pressed={rule.alwaysListen ?? false} onclick={() => rule.alwaysListen = !(rule.alwaysListen ?? false)}>
                            <span class="toggle-knob"></span>
                          </button>
                        </div>
                        <div class="toggle-item">
                          <span class="form-label">Ignore</span>
                          <button class="toggle-switch small" class:on={rule.ignore ?? false} aria-label="Ignore" aria-pressed={rule.ignore ?? false} onclick={() => rule.ignore = !(rule.ignore ?? false)}>
                            <span class="toggle-knob"></span>
                          </button>
                        </div>
                        <div class="toggle-item">
                          <span class="form-label">Read-only</span>
                          <button class="toggle-switch small" class:on={rule.readOnly ?? false} aria-label="Read-only" aria-pressed={rule.readOnly ?? false} onclick={() => rule.readOnly = !(rule.readOnly ?? false)}>
                            <span class="toggle-knob"></span>
                          </button>
                        </div>
                      </div>
                      <div class="rule-actions">
                        <button class="btn btn-primary" onclick={() => saveRule('channel', rule)} disabled={actionLoading === `save-channel-${rule.id}`}>
                          {actionLoading === `save-channel-${rule.id}` ? 'Saving...' : 'Save'}
                        </button>
                        <button class="btn btn-danger" onclick={() => deleteRule('channel', rule.id)} disabled={actionLoading === `delete-channel-${rule.id}`}>
                          {actionLoading === `delete-channel-${rule.id}` ? 'Deleting...' : 'Delete'}
                        </button>
                      </div>
                    </div>
                  {/if}
                </div>
              {/each}
              {#if addingRule === 'channel'}
                <div class="rule-card add-form">
                  <label class="form-group">
                    <span class="form-label">Channel ID</span>
                    <input type="text" class="form-input" bind:value={newRuleId} placeholder="Discord channel ID" />
                  </label>
                  <label class="form-group">
                    <span class="form-label">Name</span>
                    <input type="text" class="form-input" bind:value={newRuleName} placeholder="Channel name" />
                  </label>
                  <div class="rule-actions">
                    <button class="btn btn-primary" onclick={confirmAddRule} disabled={!newRuleId || !newRuleName}>Add</button>
                    <button class="btn btn-muted" onclick={cancelAddRule}>Cancel</button>
                  </div>
                </div>
              {:else}
                <button class="btn btn-muted add-btn" onclick={() => startAddRule('channel')}>+ Add channel rule</button>
              {/if}
            </div>
          {/if}

          <!-- User Rules -->
          {#if rulesSection === 'users'}
            <div class="rules-list">
              {#each Object.values(rules.users) as rule (rule.id)}
                {@const key = `user-${rule.id}`}
                <div class="rule-card">
                  <button class="rule-header" onclick={() => toggleRule(key)}>
                    <span class="rule-name">{rule.name}</span>
                    <span class="rule-id">{rule.id}</span>
                    <span class="chevron small" class:open={expandedRules.has(key)}>&#9656;</span>
                  </button>
                  {#if expandedRules.has(key)}
                    <div class="rule-body">
                      <label class="form-group">
                        <span class="form-label">Name</span>
                        <input type="text" class="form-input" bind:value={rule.name} />
                      </label>
                      <label class="form-group">
                        <span class="form-label">Trust level</span>
                        <select class="form-input" bind:value={rule.trustLevel}>
                          <option value="full">Full</option>
                          <option value="standard">Standard</option>
                          <option value="limited">Limited</option>
                        </select>
                      </label>
                      <label class="form-group">
                        <span class="form-label">Relationship</span>
                        <input type="text" class="form-input" bind:value={rule.relationship} />
                      </label>
                      <label class="form-group">
                        <span class="form-label">Context</span>
                        <textarea class="form-textarea" bind:value={rule.context} rows="3"></textarea>
                      </label>
                      <label class="form-group">
                        <span class="form-label">Allowed servers (IDs)</span>
                        <input type="text" class="form-input"
                          value={(rule.allowedServers || []).join(', ')}
                          onchange={(e) => rule.allowedServers = (e.target as HTMLInputElement).value.split(',').map(s => s.trim()).filter(Boolean)}
                        />
                      </label>
                      <label class="form-group">
                        <span class="form-label">Blocked servers (IDs)</span>
                        <input type="text" class="form-input"
                          value={(rule.blockedServers || []).join(', ')}
                          onchange={(e) => rule.blockedServers = (e.target as HTMLInputElement).value.split(',').map(s => s.trim()).filter(Boolean)}
                        />
                      </label>
                      <div class="rule-actions">
                        <button class="btn btn-primary" onclick={() => saveRule('user', rule)} disabled={actionLoading === `save-user-${rule.id}`}>
                          {actionLoading === `save-user-${rule.id}` ? 'Saving...' : 'Save'}
                        </button>
                        <button class="btn btn-danger" onclick={() => deleteRule('user', rule.id)} disabled={actionLoading === `delete-user-${rule.id}`}>
                          {actionLoading === `delete-user-${rule.id}` ? 'Deleting...' : 'Delete'}
                        </button>
                      </div>
                    </div>
                  {/if}
                </div>
              {/each}
              {#if addingRule === 'user'}
                <div class="rule-card add-form">
                  <label class="form-group">
                    <span class="form-label">User ID</span>
                    <input type="text" class="form-input" bind:value={newRuleId} placeholder="Discord user ID" />
                  </label>
                  <label class="form-group">
                    <span class="form-label">Name</span>
                    <input type="text" class="form-input" bind:value={newRuleName} placeholder="User name" />
                  </label>
                  <div class="rule-actions">
                    <button class="btn btn-primary" onclick={confirmAddRule} disabled={!newRuleId || !newRuleName}>Add</button>
                    <button class="btn btn-muted" onclick={cancelAddRule}>Cancel</button>
                  </div>
                </div>
              {:else}
                <button class="btn btn-muted add-btn" onclick={() => startAddRule('user')}>+ Add user rule</button>
              {/if}
            </div>
          {/if}
        {/if}
      {/if}
    </section>

    <!-- Status / Error -->
    {#if statusMessage}
      <p class="status-msg">{statusMessage}</p>
    {/if}
    {#if error}
      <p class="error-msg">{error}</p>
    {/if}
  {/if}
</div>

<style>
  .discord-panel {
    max-width: 40rem;
  }

  .loading {
    color: var(--text-muted);
    font-size: 0.875rem;
    font-style: italic;
    text-align: center;
    padding: 2rem;
  }

  .section {
    margin-bottom: 1.5rem;
    padding-bottom: 1.5rem;
    border-bottom: 1px solid var(--border);
  }

  .section:last-of-type {
    border-bottom: none;
  }

  .section-title {
    font-family: var(--font-body);
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text-primary);
    letter-spacing: 0;
    margin-bottom: 0.5rem;
  }

  .section-desc {
    font-size: 0.8125rem;
    color: var(--text-muted);
    margin-bottom: 0.75rem;
  }

  /* Collapsible header */
  .collapsible-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    color: inherit;
  }

  .collapsible-header .section-title {
    margin-bottom: 0;
  }

  .chevron {
    color: var(--text-muted);
    transition: transform 0.2s ease;
    font-size: 0.75rem;
  }

  .chevron.open {
    transform: rotate(90deg);
  }

  .chevron.small {
    font-size: 0.625rem;
  }

  /* Toggle switch */
  .toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .toggle-row.compact {
    justify-content: flex-start;
  }

  .toggle-label {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .toggle-text {
    font-size: 0.875rem;
    color: var(--text-primary);
  }

  .toggle-desc {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .toggle-switch {
    position: relative;
    width: 44px;
    height: 24px;
    border-radius: 12px;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    cursor: pointer;
    transition: all 0.2s ease;
    flex-shrink: 0;
    padding: 0;
  }

  .toggle-switch:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .toggle-switch.on {
    background: var(--accent);
    border-color: var(--accent);
  }

  .toggle-switch.small {
    width: 36px;
    height: 20px;
    border-radius: 10px;
  }

  .toggle-knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--text-muted);
    transition: all 0.2s ease;
  }

  .toggle-switch.on .toggle-knob {
    left: 22px;
    background: var(--bg-primary);
  }

  .toggle-switch.small .toggle-knob {
    width: 14px;
    height: 14px;
  }

  .toggle-switch.small.on .toggle-knob {
    left: 18px;
  }

  /* Status */
  .status-row {
    display: flex;
    align-items: center;
    gap: 0.625rem;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .status-dot.connected { background: #22c55e; }
  .status-dot.offline { background: var(--text-muted); }

  .status-text {
    font-size: 0.875rem;
  }

  .status-text.connected { color: #22c55e; }
  .status-text.offline { color: var(--text-muted); }

  .help-text {
    font-size: 0.8125rem;
    color: var(--text-muted);
    margin-top: 0.375rem;
  }

  .help-text.warning {
    color: #f59e0b;
  }

  .help-text code {
    font-size: 0.75rem;
    background: var(--bg-surface);
    padding: 0.125rem 0.375rem;
    border-radius: 3px;
    color: var(--text-secondary);
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 0.5rem;
    margin-top: 0.75rem;
  }

  .deferred-notice {
    font-size: 0.75rem;
    color: #f59e0b;
    margin-top: 0.5rem;
    font-style: italic;
  }

  .stat-card {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.625rem;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    text-align: center;
  }

  .stat-label {
    font-size: 0.6875rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .stat-value {
    font-size: 0.875rem;
    color: var(--text-primary);
    font-family: var(--font-mono, monospace);
  }

  .stat-value.error-count {
    color: #ef4444;
  }

  .pairing-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .pairing-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }

  .pairing-info {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    min-width: 0;
  }

  .pairing-user {
    font-size: 0.875rem;
    color: var(--text-primary);
  }

  .pairing-meta {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .pairing-meta code {
    font-size: 0.6875rem;
    background: var(--bg-tertiary, var(--bg-primary));
    padding: 0.0625rem 0.25rem;
    border-radius: 3px;
  }

  /* Buttons */
  .btn {
    padding: 0.375rem 0.75rem;
    font-size: 0.8125rem;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: all var(--transition);
    border: 1px solid transparent;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-primary {
    background: var(--accent);
    color: var(--bg-primary);
    border-color: var(--accent);
  }

  .btn-primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .btn-danger {
    background: transparent;
    color: #ef4444;
    border-color: #ef4444;
  }

  .btn-danger:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.1);
  }

  .btn-muted {
    background: transparent;
    color: var(--text-muted);
    border-color: var(--border);
  }

  .btn-muted:hover:not(:disabled) {
    color: var(--text-secondary);
    border-color: var(--text-muted);
  }

  .save-btn {
    margin-top: 0.75rem;
  }

  .add-btn {
    margin-top: 0.5rem;
    width: 100%;
    text-align: center;
    padding: 0.5rem;
  }

  /* Settings form */
  .settings-form {
    margin-top: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .form-label {
    font-size: 0.75rem;
    color: var(--text-muted);
    letter-spacing: 0.02em;
  }

  .form-input, .form-textarea {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-size: 0.8125rem;
    padding: 0.5rem 0.625rem;
    font-family: inherit;
    transition: border-color var(--transition);
  }

  .form-input:focus, .form-textarea:focus {
    outline: none;
    border-color: var(--border-hover);
  }

  .form-textarea {
    resize: vertical;
    min-height: 3rem;
  }

  select.form-input {
    cursor: pointer;
  }

  .form-hint {
    font-size: 0.6875rem;
    color: var(--text-muted);
    font-style: italic;
  }

  .inline-toggles {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    flex-direction: row;
  }

  .toggle-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .toggle-item .form-label {
    margin: 0;
  }

  /* Rules */
  .rules-tabs {
    display: flex;
    gap: 0;
    margin: 0.75rem 0 0.5rem;
    border-bottom: 1px solid var(--border);
  }

  .rules-tab {
    padding: 0.5rem 1rem;
    font-size: 0.75rem;
    color: var(--text-muted);
    border-bottom: 2px solid transparent;
    transition: all var(--transition);
    background: none;
    border-top: none;
    border-left: none;
    border-right: none;
    cursor: pointer;
    letter-spacing: 0.02em;
  }

  .rules-tab:hover {
    color: var(--text-secondary);
  }

  .rules-tab.active {
    color: var(--text-primary);
    background: var(--bg-active);
    border-bottom-color: transparent;
    border-radius: var(--radius-sm);
  }

  .rules-list {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    margin-top: 0.5rem;
  }

  .rule-card {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }

  .rule-card.add-form {
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .rule-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.625rem 0.75rem;
    width: 100%;
    background: none;
    border: none;
    cursor: pointer;
    color: inherit;
    text-align: left;
  }

  .rule-header:hover {
    background: var(--bg-hover);
  }

  .rule-name {
    font-size: 0.8125rem;
    color: var(--text-primary);
    flex: 1;
  }

  .rule-id {
    font-size: 0.6875rem;
    color: var(--text-muted);
    font-family: var(--font-mono, monospace);
  }

  .rule-body {
    padding: 0.75rem;
    border-top: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
  }

  .rule-actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.25rem;
  }

  .status-msg {
    font-size: 0.8125rem;
    color: #22c55e;
    margin-top: 0.75rem;
  }

  .error-msg {
    font-size: 0.8125rem;
    color: #ef4444;
    margin-top: 0.75rem;
  }

  /* Activity log */
  .log-list {
    max-height: 24rem;
    overflow-y: auto;
    margin-top: 0.5rem;
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    background: var(--bg-surface);
  }

  .log-date-sep {
    font-size: 0.6875rem;
    color: var(--text-muted);
    padding: 0.375rem 0.75rem;
    background: var(--bg-base, var(--bg-surface));
    border-bottom: 1px solid var(--border);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    position: sticky;
    top: 0;
    z-index: 1;
  }

  .log-entry {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    padding: 0.3125rem 0.75rem;
    font-size: 0.75rem;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 40%, transparent);
  }

  .log-entry:last-child {
    border-bottom: none;
  }

  .log-time {
    font-family: var(--font-mono, monospace);
    color: var(--text-muted);
    font-size: 0.6875rem;
    flex-shrink: 0;
    min-width: 5rem;
  }

  .log-level-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
    align-self: center;
  }

  .log-info .log-level-dot { background: #64748b; }
  .log-warn .log-level-dot { background: #f59e0b; }
  .log-error .log-level-dot { background: #ef4444; }

  .log-event {
    color: var(--text-primary);
    font-weight: 500;
    flex-shrink: 0;
  }

  .log-warn .log-event { color: #f59e0b; }
  .log-error .log-event { color: #ef4444; }

  .log-detail {
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (max-width: 768px) {
    .stats-grid {
      grid-template-columns: repeat(3, 1fr);
    }

    .pairing-card {
      flex-direction: column;
      align-items: stretch;
      gap: 0.5rem;
    }

    .btn {
      text-align: center;
    }

    .inline-toggles {
      flex-direction: column;
      gap: 0.5rem;
    }
  }
</style>
