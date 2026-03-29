import type { SystemStatus, OrchestratorTaskStatus, TriggerStatus } from '@resonant/shared';

// State
let systemStatus = $state<SystemStatus | null>(null);
let config = $state<Record<string, string>>({});
let failsafe = $state<{ enabled: boolean; gentle: number; concerned: number; emergency: number }>({
  enabled: true, gentle: 120, concerned: 720, emergency: 1440,
});
let triggers = $state<TriggerStatus[]>([]);
let orchestratorTasks = $state<OrchestratorTaskStatus[]>([]);
let companionName = $state('Companion');
let loading = $state(false);

// Load settings + orchestrator status + failsafe via REST
export async function loadSettings(): Promise<void> {
  loading = true;
  try {
    const [configRes, orchRes, failsafeRes, triggersRes, prefsRes] = await Promise.all([
      fetch('/api/settings', { credentials: 'include' }),
      fetch('/api/orchestrator/status', { credentials: 'include' }),
      fetch('/api/orchestrator/failsafe', { credentials: 'include' }),
      fetch('/api/orchestrator/triggers', { credentials: 'include' }),
      fetch('/api/preferences', { credentials: 'include' }),
    ]);

    if (prefsRes.ok) {
      const prefs = await prefsRes.json();
      if (prefs.identity?.companion_name) companionName = prefs.identity.companion_name;
    }

    if (configRes.ok) {
      const data = await configRes.json();
      config = data.config || {};
    }

    if (orchRes.ok) {
      const data = await orchRes.json();
      orchestratorTasks = data.tasks || [];
      if (systemStatus) {
        systemStatus = { ...systemStatus, orchestratorTasks: data.tasks };
      }
    }

    if (failsafeRes.ok) {
      const data = await failsafeRes.json();
      failsafe = data;
    }

    if (triggersRes.ok) {
      const data = await triggersRes.json();
      triggers = data.triggers || [];
    }
  } catch (err) {
    console.error('Failed to load settings:', err);
  } finally {
    loading = false;
  }
}

// Update a single config value
export async function updateSetting(key: string, value: string): Promise<boolean> {
  try {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ key, value }),
    });
    if (res.ok) {
      config = { ...config, [key]: value };
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// Toggle orchestrator task
export async function toggleTask(wakeType: string, enabled: boolean): Promise<boolean> {
  try {
    const res = await fetch(`/api/orchestrator/tasks/${wakeType}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ enabled }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.tasks) {
        orchestratorTasks = data.tasks;
        if (systemStatus) {
          systemStatus = { ...systemStatus, orchestratorTasks: data.tasks };
        }
      }
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// Reschedule orchestrator task
export async function rescheduleTask(wakeType: string, cronExpr: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/orchestrator/tasks/${wakeType}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ cronExpr }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.tasks) {
        orchestratorTasks = data.tasks;
        if (systemStatus) {
          systemStatus = { ...systemStatus, orchestratorTasks: data.tasks };
        }
      }
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// Update failsafe thresholds
export async function updateFailsafe(update: { enabled?: boolean; gentle?: number; concerned?: number; emergency?: number }): Promise<boolean> {
  try {
    const res = await fetch('/api/orchestrator/failsafe', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(update),
    });
    if (res.ok) {
      const data = await res.json();
      failsafe = { enabled: data.enabled, gentle: data.gentle, concerned: data.concerned, emergency: data.emergency };
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// Called from websocket store when system_status message arrives
// mcpServers param allows partial update from mcp_status_updated events
export function setSystemStatus(status: SystemStatus | null, mcpServers?: import('@resonant/shared').McpServerInfo[]): void {
  if (status) {
    systemStatus = status;
  }
  if (mcpServers && systemStatus) {
    systemStatus = { ...systemStatus, mcpServers };
  }
}

// Cancel a trigger
export async function cancelTriggerById(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/orchestrator/triggers/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (res.ok) {
      triggers = triggers.filter(t => t.id !== id);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// Getters
export function getSystemStatus() { return systemStatus; }
export function getConfig() { return config; }
export function getFailsafe() { return failsafe; }
export function getTriggers() { return triggers; }
export function getOrchestratorTasks() { return orchestratorTasks; }
export function getCompanionName() { return companionName; }
export function isLoading() { return loading; }
