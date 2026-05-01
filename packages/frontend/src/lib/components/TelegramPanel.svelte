<script lang="ts">
  import { onMount } from 'svelte';

  interface TelegramStatus {
    enabled: boolean;
    connected: boolean;
    configEnabled: boolean;
    hasToken: boolean;
    ownerChatId: string;
    maxMessageLength: number;
    messagesReceived?: number;
    messagesProcessed?: number;
    errors?: number;
    restarts?: number;
  }

  interface TelegramSettings {
    ownerChatId: string;
    maxMessageLength: number;
  }

  let loading = $state(true);
  let toggling = $state(false);
  let saving = $state(false);
  let error = $state<string | null>(null);
  let statusMessage = $state<string | null>(null);
  let status = $state<TelegramStatus | null>(null);
  let settings = $state<TelegramSettings>({ ownerChatId: '', maxMessageLength: 4096 });

  let isEnabled = $derived(status?.enabled ?? false);

  async function loadData() {
    error = null;
    try {
      const [statusRes, settingsRes] = await Promise.all([
        fetch('/api/telegram/status'),
        fetch('/api/telegram/settings'),
      ]);
      if (statusRes.ok) status = await statusRes.json();
      if (settingsRes.ok) settings = await settingsRes.json();
    } catch {
      error = 'Failed to load Telegram status';
    } finally {
      loading = false;
    }
  }

  async function toggleTelegram() {
    toggling = true;
    error = null;
    const nextEnabled = !isEnabled;
    try {
      const res = await fetch('/api/telegram/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: nextEnabled }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Toggle failed');
      statusMessage = data.message || (nextEnabled ? 'Telegram gateway started' : 'Telegram gateway stopped');
      setTimeout(() => statusMessage = null, 3000);
      await loadData();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to toggle Telegram';
    } finally {
      toggling = false;
    }
  }

  async function saveSettings() {
    saving = true;
    error = null;
    try {
      const res = await fetch('/api/telegram/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      settings = data;
      statusMessage = 'Telegram settings saved';
      setTimeout(() => statusMessage = null, 3000);
      await loadData();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to save Telegram settings';
    } finally {
      saving = false;
    }
  }

  onMount(loadData);
</script>

<div class="telegram-panel">
  {#if loading}
    <p class="loading">Loading Telegram status...</p>
  {:else}
    <section class="section">
      <h3 class="section-title">Telegram Gateway</h3>
      {#if !status?.hasToken}
        <p class="help-text warning">No bot token configured. Add <code>TELEGRAM_BOT_TOKEN</code> to .env and restart.</p>
      {:else}
        <div class="toggle-row">
          <div class="toggle-label">
            <span class="toggle-text">{isEnabled ? 'Gateway active' : 'Gateway off'}</span>
            <span class="toggle-desc">Route Telegram messages into the active conversation</span>
          </div>
          <button class="toggle-switch" class:on={isEnabled} onclick={toggleTelegram} disabled={toggling} aria-label={isEnabled ? 'Disable Telegram' : 'Enable Telegram'}>
            <span class="toggle-knob"></span>
          </button>
        </div>
      {/if}
    </section>

    {#if isEnabled}
      <section class="section">
        <h3 class="section-title">Connection</h3>
        <div class="status-row">
          <span class="status-dot" class:connected={status?.connected} class:offline={!status?.connected}></span>
          <span class="status-text" class:connected={status?.connected} class:offline={!status?.connected}>
            {status?.connected ? 'Polling active' : 'Connecting...'}
          </span>
        </div>
        <div class="stats-grid">
          <div class="stat-card">
            <span class="stat-label">Received</span>
            <span class="stat-value">{status?.messagesReceived ?? 0}</span>
          </div>
          <div class="stat-card">
            <span class="stat-label">Processed</span>
            <span class="stat-value">{status?.messagesProcessed ?? 0}</span>
          </div>
          <div class="stat-card">
            <span class="stat-label">Restarts</span>
            <span class="stat-value">{status?.restarts ?? 0}</span>
          </div>
          <div class="stat-card">
            <span class="stat-label">Errors</span>
            <span class="stat-value" class:error-count={(status?.errors ?? 0) > 0}>{status?.errors ?? 0}</span>
          </div>
        </div>
      </section>
    {/if}

    <section class="section">
      <h3 class="section-title">Gateway Settings</h3>
      <div class="settings-form">
        <label class="form-group">
          <span class="form-label">Owner Chat ID</span>
          <input type="text" class="form-input" bind:value={settings.ownerChatId} placeholder="Leave blank to bind on /start" />
          <span class="form-hint">If blank, the first /start message claims this private bot.</span>
        </label>
        <label class="form-group">
          <span class="form-label">Max Message Length</span>
          <input type="number" min="1000" max="4096" class="form-input" bind:value={settings.maxMessageLength} />
        </label>
        <button class="btn btn-primary save-btn" onclick={saveSettings} disabled={saving}>
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </section>

    <section class="section">
      <h3 class="section-title">Setup</h3>
      <ol class="setup-steps">
        <li>Create a bot with <code>@BotFather</code> and copy its token.</li>
        <li>Add <code>TELEGRAM_BOT_TOKEN=your_bot_token</code> to <code>.env</code>, then restart.</li>
        <li>Send <code>/start</code> to the bot to bind the owner chat, or paste the chat ID above.</li>
      </ol>
    </section>

    {#if statusMessage}
      <p class="status-msg">{statusMessage}</p>
    {/if}
    {#if error}
      <p class="error-msg">{error}</p>
    {/if}
  {/if}
</div>

<style>
  .telegram-panel {
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

  .toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
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

  .toggle-desc,
  .help-text,
  .form-hint {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .help-text.warning {
    color: #f59e0b;
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

  .toggle-switch.on {
    background: var(--accent);
    border-color: var(--accent);
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
  .status-text.connected { color: #22c55e; }
  .status-text.offline { color: var(--text-muted); }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.5rem;
    margin-top: 0.75rem;
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

  .stat-value.error-count,
  .error-msg {
    color: #ef4444;
  }

  .settings-form {
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
  }

  .form-input {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-size: 0.8125rem;
    padding: 0.5rem 0.625rem;
    font-family: inherit;
  }

  .btn {
    padding: 0.375rem 0.75rem;
    font-size: 0.8125rem;
    border-radius: var(--radius-sm);
    cursor: pointer;
    border: 1px solid transparent;
    white-space: nowrap;
  }

  .btn-primary {
    background: var(--accent);
    color: var(--bg-primary);
    border-color: var(--accent);
  }

  .save-btn {
    align-self: flex-start;
  }

  .setup-steps {
    margin: 0;
    padding-left: 1.1rem;
    font-size: 0.8125rem;
    line-height: 1.7;
    color: var(--text-secondary);
  }

  code {
    font-family: var(--font-mono, monospace);
    font-size: 0.75rem;
    background: var(--bg-surface);
    padding: 0.125rem 0.375rem;
    border-radius: 3px;
    color: var(--text-secondary);
  }

  .status-msg {
    font-size: 0.8125rem;
    color: #22c55e;
    margin-top: 0.75rem;
  }

  .error-msg {
    font-size: 0.8125rem;
    margin-top: 0.75rem;
  }

  @media (max-width: 768px) {
    .stats-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }
</style>
