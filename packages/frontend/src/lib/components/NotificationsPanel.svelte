<script lang="ts">
  import { onMount } from 'svelte';
  import { getNotificationPermission, requestNotificationPermission } from '$lib/stores/websocket.svelte';

  let permission = $derived(getNotificationPermission());
  let vapidPublicKey = $state<string | null>(null);
  let isSubscribed = $state(false);
  let subscriptions = $state<Array<{ id: string; deviceName: string | null; endpoint: string | null; createdAt: string; lastUsedAt: string | null }>>([]);
  let loading = $state(true);
  let testSending = $state(false);
  let error = $state<string | null>(null);
  let statusMessage = $state<string | null>(null);

  function urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  async function checkSubscription() {
    if (!('serviceWorker' in navigator)) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      isSubscribed = !!sub;
    } catch {
      isSubscribed = false;
    }
  }

  async function loadData() {
    try {
      const [vapidRes, subsRes] = await Promise.all([
        fetch('/api/push/vapid-public'),
        fetch('/api/push/subscriptions'),
      ]);
      if (vapidRes.ok) {
        const data = await vapidRes.json();
        vapidPublicKey = data.publicKey;
      }
      if (subsRes.ok) {
        const data = await subsRes.json();
        subscriptions = data.subscriptions;
      }
    } catch (err) {
      error = 'Failed to load notification settings';
    } finally {
      loading = false;
    }
  }

  async function handlePermission() {
    const result = await requestNotificationPermission();
    if (result === 'denied') {
      error = 'Notifications blocked by browser. Enable in site settings.';
    }
  }

  async function subscribe() {
    if (!vapidPublicKey) {
      error = 'VAPID key not configured on server';
      return;
    }
    error = null;
    try {
      const reg = await navigator.serviceWorker.ready;
      const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey) as unknown as BufferSource;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });

      const json = sub.toJSON();
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: json.keys,
          deviceLabel: navigator.userAgent.includes('iPhone') ? 'iPhone'
            : navigator.userAgent.includes('Android') ? 'Android'
            : navigator.userAgent.includes('Mac') ? 'Mac'
            : 'Browser',
        }),
      });

      if (!res.ok) throw new Error('Server rejected subscription');
      isSubscribed = true;
      statusMessage = 'Subscribed to push notifications';
      setTimeout(() => statusMessage = null, 3000);
      await loadData();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to subscribe';
    }
  }

  async function unsubscribe() {
    error = null;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint }),
        });
      }
      isSubscribed = false;
      statusMessage = 'Unsubscribed from push notifications';
      setTimeout(() => statusMessage = null, 3000);
      await loadData();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to unsubscribe';
    }
  }

  async function sendTest() {
    testSending = true;
    error = null;
    try {
      const res = await fetch('/api/push/test', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Test failed');
      }
      statusMessage = 'Test notification sent!';
      setTimeout(() => statusMessage = null, 3000);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to send test';
    } finally {
      testSending = false;
    }
  }

  onMount(() => {
    loadData();
    checkSubscription();
  });
</script>

<div class="notifications-panel">
  {#if loading}
    <p class="loading">Loading notification settings...</p>
  {:else}
    <!-- Browser Permission -->
    <section class="section">
      <h3 class="section-title">Browser Permission</h3>
      <div class="permission-row">
        <span class="status-dot" class:granted={permission === 'granted'} class:denied={permission === 'denied'} class:default={permission === 'default'}></span>
        {#if permission === 'granted'}
          <span class="status-text granted">Notifications allowed</span>
        {:else if permission === 'denied'}
          <span class="status-text denied">Notifications blocked</span>
          <p class="help-text">Enable in your browser's site settings for this page.</p>
        {:else}
          <button class="btn btn-primary" onclick={handlePermission}>Allow Notifications</button>
        {/if}
      </div>
    </section>

    <!-- Push Subscription -->
    <section class="section">
      <h3 class="section-title">Push Notifications</h3>
      <p class="section-desc">Receive notifications even when the browser is closed.</p>
      {#if !vapidPublicKey}
        <p class="help-text warning">VAPID keys not configured on server. Push unavailable.</p>
      {:else if permission !== 'granted'}
        <p class="help-text">Grant browser permission first.</p>
      {:else if isSubscribed}
        <div class="sub-row">
          <span class="status-dot granted"></span>
          <span class="status-text granted">This device is subscribed</span>
          <button class="btn btn-danger" onclick={unsubscribe}>Unsubscribe</button>
        </div>
      {:else}
        <button class="btn btn-primary" onclick={subscribe}>Subscribe This Device</button>
      {/if}
    </section>

    <!-- Test -->
    {#if isSubscribed}
      <section class="section">
        <h3 class="section-title">Test</h3>
        <button class="btn btn-secondary" onclick={sendTest} disabled={testSending}>
          {testSending ? 'Sending...' : 'Send Test Push'}
        </button>
      </section>
    {/if}

    <!-- Registered Devices -->
    {#if subscriptions.length > 0}
      <section class="section">
        <h3 class="section-title">Registered Devices</h3>
        <div class="device-list">
          {#each subscriptions as sub}
            <div class="device-card">
              <span class="device-name">{sub.deviceName || 'Unknown device'}</span>
              <span class="device-meta">
                Added {new Date(sub.createdAt).toLocaleDateString()}
                {#if sub.lastUsedAt}
                  &middot; Last push {new Date(sub.lastUsedAt).toLocaleDateString()}
                {/if}
              </span>
            </div>
          {/each}
        </div>
      </section>
    {/if}

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
  .notifications-panel {
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

  .permission-row, .sub-row {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    flex-wrap: wrap;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .status-dot.granted { background: #22c55e; }
  .status-dot.denied { background: #ef4444; }
  .status-dot.default { background: var(--text-muted); }

  .status-text {
    font-size: 0.875rem;
  }

  .status-text.granted { color: #22c55e; }
  .status-text.denied { color: #ef4444; }

  .help-text {
    font-size: 0.8125rem;
    color: var(--text-muted);
    margin-top: 0.375rem;
  }

  .help-text.warning {
    color: #f59e0b;
  }

  .btn {
    padding: 0.5rem 1rem;
    font-size: 0.8125rem;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: all var(--transition);
    border: 1px solid transparent;
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

  .btn-secondary {
    background: var(--bg-surface);
    color: var(--text-secondary);
    border-color: var(--border);
  }

  .btn-secondary:hover:not(:disabled) {
    border-color: var(--border-hover);
    color: var(--text-primary);
  }

  .btn-danger {
    background: transparent;
    color: #ef4444;
    border-color: #ef4444;
  }

  .btn-danger:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.1);
  }

  .device-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .device-card {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    padding: 0.75rem 1rem;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }

  .device-name {
    font-size: 0.875rem;
    color: var(--text-primary);
  }

  .device-meta {
    font-size: 0.75rem;
    color: var(--text-muted);
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
</style>
