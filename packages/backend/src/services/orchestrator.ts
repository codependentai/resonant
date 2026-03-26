import * as cron from 'node-cron';
import crypto from 'crypto';
import { appendFileSync, mkdirSync, existsSync, statSync, renameSync, unlinkSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { AgentService } from './agent.js';
import type { PushService } from './push.js';
import { registry } from './ws.js';
import {
  createThread,
  createMessage,
  getTodayThread,
  getThread,
  updateThreadSession,
  updateThreadActivity,
  getConfigBool,
  getConfigNumber,
  getConfig,
  setConfig,
  getConfigsByPrefix,
  deleteConfig,
  getDueTimers,
  markTimerFired,
  getActiveTriggers,
  markTriggerWaiting,
  markTriggerFired,
  markWatcherFired,
} from './db.js';
import type { Trigger, TriggerCondition } from './db.js';
import { evaluateConditions } from './triggers.js';
import type { TriggerContext } from './triggers.js';
import { fetchLifeStatus } from './hooks.js';
import { getResonantConfig } from '../config.js';
import type { OrchestratorTaskStatus } from '@resonant/shared';

// --- Orchestrator log ---

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve log path: works from both src/ (tsx) and dist/ (compiled)
const LOG_DIR = join(__dirname, '..', '..', '..', '..', 'logs');
const LOG_PATH = join(LOG_DIR, 'orchestrator.log');
const LOG_MAX_BYTES = 5 * 1024 * 1024; // 5MB

if (!existsSync(LOG_DIR)) {
  mkdirSync(LOG_DIR, { recursive: true });
}

function rotateLogIfNeeded(): void {
  try {
    if (!existsSync(LOG_PATH)) return;
    const { size } = statSync(LOG_PATH);
    if (size < LOG_MAX_BYTES) return;
    const backup = LOG_PATH + '.1';
    if (existsSync(backup)) unlinkSync(backup);
    renameSync(LOG_PATH, backup);
  } catch {
    // Non-critical — continue logging
  }
}

function olog(message: string): void {
  const ts = new Date().toISOString().replace('T', ' ').replace('Z', '');
  const line = `${ts}  ${message}\n`;
  rotateLogIfNeeded();
  appendFileSync(LOG_PATH, line);
  console.log(`[Orchestrator] ${message}`);
}

// --- Wake prompt loading ---

const WAKE_PROMPT_PREFIX = `Follow your system prompt.`;

function getDefaultWakePrompts(userName: string): Record<string, string> {
  return {
    morning: `Good morning. Orient yourself, check in with ${userName}.`,
    midday: `Afternoon check-in. How is ${userName} doing?`,
    evening: `Evening wind-down. Reflect on the day.`,
    failsafe_gentle: `It's been a while since you heard from ${userName}. Check in.`,
    failsafe_concerned: `It's been a long time since contact with ${userName}. Reach out through available channels.`,
    failsafe_emergency: `Extended silence from ${userName}. Use all available channels to check in.`,
  };
}

function parseWakePromptsFile(filePath: string, userName: string): Record<string, string> {
  const defaults = getDefaultWakePrompts(userName);

  if (!existsSync(filePath)) {
    olog(`Wake prompts file not found at ${filePath} — using defaults`);
    return defaults;
  }

  try {
    const raw = readFileSync(filePath, 'utf-8');
    const sections: Record<string, string> = {};
    let currentSection: string | null = null;
    const lines: string[] = [];

    for (const line of raw.split('\n')) {
      const sectionMatch = line.match(/^##\s+(\w+)/);
      if (sectionMatch) {
        if (currentSection) {
          sections[currentSection] = lines.join('\n').trim();
        }
        currentSection = sectionMatch[1].toLowerCase();
        lines.length = 0;
      } else if (currentSection) {
        lines.push(line);
      }
    }
    if (currentSection) {
      sections[currentSection] = lines.join('\n').trim();
    }

    // Merge: defaults first, then all parsed sections (including custom ones)
    return { ...defaults, ...sections };

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    olog(`Failed to parse wake prompts file: ${errMsg} — using defaults`);
    return defaults;
  }
}

// --- Default schedule definitions ---

interface TaskDefinition {
  wakeType: string;
  label: string;
  cronExpr: string;
  category: 'wake' | 'checkin' | 'handoff' | 'failsafe' | 'routine';
  conditional?: boolean; // If true, checks shouldSkipCheckIn before firing
  freshSession?: boolean; // If true, creates a new session
}

const DEFAULT_TASKS: TaskDefinition[] = [
  { wakeType: 'morning', label: '8:00 AM — Morning', cronExpr: '0 8 * * *', category: 'checkin', conditional: true },
  { wakeType: 'midday', label: '1:00 PM — Midday', cronExpr: '0 13 * * *', category: 'checkin', conditional: true },
  { wakeType: 'evening', label: '9:00 PM — Evening', cronExpr: '0 21 * * *', category: 'checkin' },
];

// --- Managed task interface ---

interface ManagedTask {
  task: cron.ScheduledTask;
  cronExpr: string;
  handler: () => void | Promise<void>;
  wakeType: string;
  label: string;
  enabled: boolean;
  category: 'wake' | 'checkin' | 'handoff' | 'failsafe' | 'routine';
}

// --- Default failsafe thresholds (minutes) ---

const DEFAULT_FAILSAFE_GENTLE = 120;
const DEFAULT_FAILSAFE_CONCERNED = 720;
const DEFAULT_FAILSAFE_EMERGENCY = 1440;

// --- Orchestrator ---

export class Orchestrator {
  private agent: AgentService;
  private pushService: PushService | null;
  private tasks = new Map<string, ManagedTask>();
  private failsafeInterval: ReturnType<typeof setInterval> | null = null;
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private lastFailsafeAction: Date = new Date(0);
  private failsafeEnabled = true;
  private failsafeGentle = DEFAULT_FAILSAFE_GENTLE;
  private failsafeConcerned = DEFAULT_FAILSAFE_CONCERNED;
  private failsafeEmergency = DEFAULT_FAILSAFE_EMERGENCY;
  private pulseInterval: ReturnType<typeof setInterval> | null = null;
  private pulseEnabled = false;
  private pulseFrequency = 15; // minutes
  private lastUserPresenceState: 'active' | 'idle' | 'offline' = 'offline';
  private wakePrompts: Record<string, string> = {};

  constructor(agent: AgentService, pushService?: PushService) {
    this.agent = agent;
    this.pushService = pushService || null;
  }

  start(): void {
    olog('Starting...');

    const config = getResonantConfig();
    const timezone = config.identity.timezone;
    const userName = config.identity.user_name;

    // Load wake prompts from file or use defaults
    const loadedPrompts = parseWakePromptsFile(config.orchestrator.wake_prompts_path, userName);
    this.wakePrompts = {};
    for (const [key, prompt] of Object.entries(loadedPrompts)) {
      this.wakePrompts[key] = `${WAKE_PROMPT_PREFIX}\n\n${prompt}`;
    }

    // Load failsafe config from DB, falling back to yaml config, then defaults
    this.failsafeEnabled = getConfigBool('failsafe.enabled', config.orchestrator.failsafe.enabled);
    this.failsafeGentle = getConfigNumber('failsafe.gentle', config.orchestrator.failsafe.gentle_minutes || DEFAULT_FAILSAFE_GENTLE);
    this.failsafeConcerned = getConfigNumber('failsafe.concerned', config.orchestrator.failsafe.concerned_minutes || DEFAULT_FAILSAFE_CONCERNED);
    this.failsafeEmergency = getConfigNumber('failsafe.emergency', config.orchestrator.failsafe.emergency_minutes || DEFAULT_FAILSAFE_EMERGENCY);

    // Load pulse config from DB
    this.pulseEnabled = getConfigBool('pulse.enabled', false);
    this.pulseFrequency = getConfigNumber('pulse.frequency', 15);

    // Apply any schedule overrides from config + register custom wake types
    const defaultWakeTypes = new Set(DEFAULT_TASKS.map(d => d.wakeType));
    const taskDefs: TaskDefinition[] = DEFAULT_TASKS.map(def => {
      const overrideCron = config.orchestrator.schedules[def.wakeType];
      if (overrideCron) {
        return { ...def, cronExpr: overrideCron };
      }
      return def;
    });

    // Add custom schedule entries not in DEFAULT_TASKS
    for (const [wakeType, cronExpr] of Object.entries(config.orchestrator.schedules)) {
      if (defaultWakeTypes.has(wakeType)) continue; // already handled above
      const label = wakeType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      taskDefs.push({
        wakeType,
        label,
        cronExpr,
        category: 'checkin',
        conditional: true,
      });
      // Ensure a wake prompt exists for this custom type
      if (!this.wakePrompts[wakeType]) {
        this.wakePrompts[wakeType] = `${WAKE_PROMPT_PREFIX}\n\nScheduled check-in (${label}).`;
      }
    }

    // Register all scheduled tasks
    for (const def of taskDefs) {
      const savedCron = getConfig(`cron.${def.wakeType}.schedule`);
      const cronExpr = savedCron || def.cronExpr;
      const enabled = getConfigBool(`cron.${def.wakeType}.enabled`, true);
      if (savedCron) olog(`  ${def.wakeType}: using saved schedule ${cronExpr}`);

      const handler = () => {

        if (def.conditional && this.shouldSkipCheckIn()) {
          olog(`${def.wakeType} — skipped (user active)`);
          return;
        }
        this.handleWake(def.wakeType, { freshSession: def.freshSession });
      };

      const task = cron.schedule(cronExpr, handler, {
        timezone,
      });

      // node-cron v4 auto-starts tasks; stop if disabled in config
      if (!enabled) {
        task.stop();
        olog(`  ${def.wakeType}: DISABLED (persisted)`);
      }

      this.tasks.set(def.wakeType, {
        task,
        cronExpr,
        handler,
        wakeType: def.wakeType,
        label: def.label,
        enabled,
        category: def.category,
      });
    }

    // --- Load custom routines from DB ---
    const customConfigs = getConfigsByPrefix('custom_routine.');
    const customRoutines = new Map<string, { label?: string; cronExpr?: string; prompt?: string }>();

    for (const [key, value] of Object.entries(customConfigs)) {
      const parts = key.split('.');
      if (parts.length !== 3) continue;
      const wakeType = parts[1];
      const field = parts[2];
      if (!customRoutines.has(wakeType)) customRoutines.set(wakeType, {});
      const entry = customRoutines.get(wakeType)!;
      if (field === 'label') entry.label = value;
      else if (field === 'cronExpr') entry.cronExpr = value;
      else if (field === 'prompt') entry.prompt = value;
    }

    for (const [wakeType, routineConfig] of customRoutines) {
      if (!routineConfig.label || !routineConfig.cronExpr || !routineConfig.prompt) {
        olog(`  custom routine ${wakeType}: incomplete config, skipping`);
        continue;
      }
      this.addRoutine({
        wakeType,
        label: routineConfig.label,
        cronExpr: routineConfig.cronExpr,
        prompt: routineConfig.prompt,
      });
    }

    // --- Failsafe polling (every 15 minutes) ---
    if (this.failsafeEnabled) {
      this.failsafeInterval = setInterval(() => this.checkFailsafe(), 15 * 60 * 1000);
    }

    // --- Timer + Trigger polling (every 60 seconds) ---
    this.timerInterval = setInterval(async () => {
      await this.checkTimers();
      await this.checkTriggers();
    }, 60 * 1000);

    olog('All schedules registered');
    const checkinNames = taskDefs.map(d => d.wakeType).join(', ');
    olog(`Check-ins: ${checkinNames}`);
    olog(`Failsafe: ${this.failsafeEnabled ? 'every 15 minutes' : 'DISABLED'}`);
    olog(`Failsafe thresholds: gentle=${this.failsafeGentle}m, concerned=${this.failsafeConcerned}m, emergency=${this.failsafeEmergency}m`);
    // --- Pulse (lightweight awareness check) ---
    if (this.pulseEnabled) {
      this.pulseInterval = setInterval(() => this.checkPulse(), this.pulseFrequency * 60 * 1000);
    }

    olog('Timers + Triggers: polling every 60s');
    olog(`Pulse: ${this.pulseEnabled ? `every ${this.pulseFrequency}m` : 'DISABLED'}`);
  }

  stop(): void {
    olog('Stopping...');
    for (const [, managed] of this.tasks) {
      managed.task.stop();
    }
    this.tasks.clear();
    if (this.failsafeInterval) {
      clearInterval(this.failsafeInterval);
      this.failsafeInterval = null;
    }
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    if (this.pulseInterval) {
      clearInterval(this.pulseInterval);
      this.pulseInterval = null;
    }
  }

  // --- Public runtime control methods ---

  async getStatus(): Promise<OrchestratorTaskStatus[]> {
    const statuses: OrchestratorTaskStatus[] = [];

    for (const [, managed] of this.tasks) {
      let status: 'scheduled' | 'stopped' | 'running' = 'stopped';
      let nextRun: string | null = null;

      try {
        const cronStatus = await managed.task.getStatus();
        status = cronStatus === 'scheduled' ? 'scheduled' :
                 cronStatus === 'running' ? 'running' : 'stopped';
      } catch {
        status = managed.enabled ? 'scheduled' : 'stopped';
      }

      try {
        const next = managed.task.getNextRun();
        if (next) nextRun = next.toISOString();
      } catch {
        // Not available
      }

      statuses.push({
        wakeType: managed.wakeType,
        label: managed.label,
        cronExpr: managed.cronExpr,
        enabled: managed.enabled,
        status,
        nextRun,
        category: managed.category,
      });
    }

    return statuses;
  }

  enableTask(wakeType: string): boolean {
    const managed = this.tasks.get(wakeType);
    if (!managed) return false;

    managed.task.start();
    managed.enabled = true;
    setConfig(`cron.${wakeType}.enabled`, 'true');
    olog(`ENABLED: ${wakeType}`);
    return true;
  }

  disableTask(wakeType: string): boolean {
    const managed = this.tasks.get(wakeType);
    if (!managed) return false;

    managed.task.stop();
    managed.enabled = false;
    setConfig(`cron.${wakeType}.enabled`, 'false');
    olog(`DISABLED: ${wakeType}`);
    return true;
  }

  rescheduleTask(wakeType: string, newCronExpr: string): boolean {
    const managed = this.tasks.get(wakeType);
    if (!managed) return false;

    if (!cron.validate(newCronExpr)) {
      olog(`RESCHEDULE FAILED: ${wakeType} — invalid cron expression: ${newCronExpr}`);
      return false;
    }

    const config = getResonantConfig();

    // Destroy old task and create new one
    managed.task.stop();

    const newTask = cron.schedule(newCronExpr, managed.handler, {
      timezone: config.identity.timezone,
    });

    // Respect current enabled state
    if (!managed.enabled) {
      newTask.stop();
    }

    managed.task = newTask;
    managed.cronExpr = newCronExpr;
    setConfig(`cron.${wakeType}.schedule`, newCronExpr);
    olog(`RESCHEDULED: ${wakeType} -> ${newCronExpr}`);
    return true;
  }

  getFailsafeConfig(): { enabled: boolean; gentle: number; concerned: number; emergency: number } {
    return {
      enabled: this.failsafeEnabled,
      gentle: this.failsafeGentle,
      concerned: this.failsafeConcerned,
      emergency: this.failsafeEmergency,
    };
  }

  setFailsafeConfig(config: { enabled?: boolean; gentle?: number; concerned?: number; emergency?: number }): void {
    if (config.enabled !== undefined) {
      this.failsafeEnabled = config.enabled;
      setConfig('failsafe.enabled', String(config.enabled));

      // Start or stop failsafe interval
      if (config.enabled && !this.failsafeInterval) {
        this.failsafeInterval = setInterval(() => this.checkFailsafe(), 15 * 60 * 1000);
        olog('Failsafe ENABLED');
      } else if (!config.enabled && this.failsafeInterval) {
        clearInterval(this.failsafeInterval);
        this.failsafeInterval = null;
        olog('Failsafe DISABLED');
      }
    }

    if (config.gentle !== undefined) {
      this.failsafeGentle = config.gentle;
      setConfig('failsafe.gentle', String(config.gentle));
    }
    if (config.concerned !== undefined) {
      this.failsafeConcerned = config.concerned;
      setConfig('failsafe.concerned', String(config.concerned));
    }
    if (config.emergency !== undefined) {
      this.failsafeEmergency = config.emergency;
      setConfig('failsafe.emergency', String(config.emergency));
    }

    olog(`Failsafe config updated: enabled=${this.failsafeEnabled}, gentle=${this.failsafeGentle}m, concerned=${this.failsafeConcerned}m, emergency=${this.failsafeEmergency}m`);
  }

  // --- Custom routine management ---

  addRoutine(params: {
    wakeType: string;
    label: string;
    cronExpr: string;
    prompt: string;
  }): boolean {
    if (this.tasks.has(params.wakeType)) {
      olog(`ADD ROUTINE FAILED: ${params.wakeType} — already exists`);
      return false;
    }

    if (!cron.validate(params.cronExpr)) {
      olog(`ADD ROUTINE FAILED: ${params.wakeType} — invalid cron: ${params.cronExpr}`);
      return false;
    }

    const config = getResonantConfig();
    const handler = () => {
      this.handleWake(params.wakeType);
    };

    const task = cron.schedule(params.cronExpr, handler, {
      timezone: config.identity.timezone,
    });

    this.tasks.set(params.wakeType, {
      task,
      cronExpr: params.cronExpr,
      handler,
      wakeType: params.wakeType,
      label: params.label,
      enabled: true,
      category: 'routine',
    });

    // Persist to DB
    setConfig(`custom_routine.${params.wakeType}.label`, params.label);
    setConfig(`custom_routine.${params.wakeType}.cronExpr`, params.cronExpr);
    setConfig(`custom_routine.${params.wakeType}.prompt`, params.prompt);

    olog(`ROUTINE ADDED: ${params.wakeType} (${params.cronExpr}) — "${params.label}"`);
    return true;
  }

  removeRoutine(wakeType: string): boolean {
    const managed = this.tasks.get(wakeType);
    if (!managed) return false;

    // Only allow removal of custom routines, not defaults
    const isDefault = DEFAULT_TASKS.some(t => t.wakeType === wakeType);
    if (isDefault) {
      olog(`REMOVE ROUTINE FAILED: ${wakeType} — cannot remove default task (use disable instead)`);
      return false;
    }

    managed.task.stop();
    this.tasks.delete(wakeType);

    deleteConfig(`custom_routine.${wakeType}.label`);
    deleteConfig(`custom_routine.${wakeType}.cronExpr`);
    deleteConfig(`custom_routine.${wakeType}.prompt`);
    deleteConfig(`cron.${wakeType}.schedule`);
    deleteConfig(`cron.${wakeType}.enabled`);

    olog(`ROUTINE REMOVED: ${wakeType}`);
    return true;
  }

  // --- Pulse config ---

  getPulseConfig(): { enabled: boolean; frequency: number } {
    return { enabled: this.pulseEnabled, frequency: this.pulseFrequency };
  }

  setPulseConfig(config: { enabled?: boolean; frequency?: number }): void {
    if (config.enabled !== undefined) {
      this.pulseEnabled = config.enabled;
      setConfig('pulse.enabled', String(config.enabled));

      if (config.enabled && !this.pulseInterval) {
        this.pulseInterval = setInterval(() => this.checkPulse(), this.pulseFrequency * 60 * 1000);
        olog('Pulse ENABLED');
      } else if (!config.enabled && this.pulseInterval) {
        clearInterval(this.pulseInterval);
        this.pulseInterval = null;
        olog('Pulse DISABLED');
      }
    }

    if (config.frequency !== undefined && config.frequency >= 5) {
      this.pulseFrequency = config.frequency;
      setConfig('pulse.frequency', String(config.frequency));

      if (this.pulseEnabled && this.pulseInterval) {
        clearInterval(this.pulseInterval);
        this.pulseInterval = setInterval(() => this.checkPulse(), this.pulseFrequency * 60 * 1000);
      }
    }

    olog(`Pulse config updated: enabled=${this.pulseEnabled}, frequency=${this.pulseFrequency}m`);
  }

  // --- Pulse: lightweight awareness check ---

  private async checkPulse(): Promise<void> {
    const now = new Date();
    const hour = now.getHours();

    if (hour < 8) return;
    if (this.agent.isProcessing()) return;
    if (registry.getUserPresenceState() === 'active') return;

    const presence = registry.getUserPresenceState();
    const minutesSince = Math.round(registry.minutesSinceLastUserActivity());
    const device = registry.getUserDeviceType();
    const localTime = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const triggers = getActiveTriggers();

    const pulsePrompt = [
      'Quick awareness check. You don\'t have to say anything.',
      '',
      `User: ${presence}, last active ${minutesSince}min ago. Device: ${device}.`,
      `Time: ${localTime}. Active triggers: ${triggers.length}.`,
      '',
      'If something here warrants reaching out — a message, a reminder, a gentle pull — do it.',
      'If nothing needs attention, respond with just: PULSE_OK',
    ].join('\n');

    try {
      let thread = getTodayThread();
      if (!thread) return;

      const response = await this.agent.processAutonomous(thread.id, pulsePrompt);

      if (response.trim().startsWith('PULSE_OK')) {
        return;
      }

      updateThreadActivity(thread.id, new Date().toISOString(), true);
      olog(`PULSE: responded (${response.length} chars)`);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      olog(`PULSE ERROR: ${errMsg}`);
    }
  }

  // --- Public manual wake (called from /wake command) ---

  async triggerManualWake(wakeType = 'manual'): Promise<void> {
    await this.handleWake(wakeType);
  }

  // --- Core wake handler ---

  private async handleWake(
    wakeType: string,
    opts?: { freshSession?: boolean }
  ): Promise<void> {
    const prompt = this.wakePrompts[wakeType] || getConfig(`custom_routine.${wakeType}.prompt`);
    if (!prompt) {
      olog(`ERROR: Unknown wake type: ${wakeType}`);
      return;
    }

    // Don't fire if agent is already processing a query
    if (this.agent.isProcessing()) {
      olog(`${wakeType} — skipped (agent busy)`);
      return;
    }

    olog(`WAKE: ${wakeType}`);

    try {
      // Get or create today's daily thread
      let thread = getTodayThread();

      if (!thread) {
        // Create new daily thread (only when none exists for today)
        const now = new Date();
        const dayName = now.toLocaleDateString('en-GB', {
          weekday: 'long',
          month: 'short',
          day: 'numeric',
        });

        thread = createThread({
          id: crypto.randomUUID(),
          name: dayName,
          type: 'daily',
          createdAt: now.toISOString(),
          sessionType: 'v1',
        });

        // Broadcast new thread to connected clients
        registry.broadcast({ type: 'thread_created', thread });
        olog(`Created daily thread: ${thread.name} (${thread.id})`);
      }

      // Fresh session: clear session on existing thread (don't create duplicate)
      if (opts?.freshSession) {
        updateThreadSession(thread.id, null);
      }

      // Fire the autonomous query
      const response = await this.agent.processAutonomous(thread.id, prompt);

      // Update thread activity
      updateThreadActivity(thread.id, new Date().toISOString(), true);

      olog(`DONE: ${wakeType} (${response.length} chars)`);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      olog(`ERROR: ${wakeType} failed — ${errMsg}`);
    }
  }

  // --- Failsafe ---

  private checkFailsafe(): void {
    const config = getResonantConfig();
    const timezone = config.identity.timezone;
    const now = new Date();
    const hour = parseInt(now.toLocaleString('en-GB', { timeZone: timezone, hour: '2-digit', hour12: false }));

    // Only check during waking hours (8am - midnight)
    if (hour < 8) return;

    // Only skip if user is genuinely active (tab focused + recent real interaction)
    if (registry.getUserPresenceState() === 'active') return;

    const minutesSince = registry.minutesSinceLastUserActivity();

    // Don't re-trigger failsafe within 2 hours of last action
    const minutesSinceLastAction = (now.getTime() - this.lastFailsafeAction.getTime()) / 60000;
    if (minutesSinceLastAction < 120) return;

    // Tiered escalation using configurable thresholds
    if (minutesSince > this.failsafeEmergency) {
      // 24+ hours — emergency
      olog(`FAILSAFE EMERGENCY — ${Math.round(minutesSince / 60)}h since contact`);
      this.lastFailsafeAction = now;
      this.handleWake('failsafe_emergency');
    } else if (minutesSince > this.failsafeConcerned) {
      // 12+ hours — concerned
      olog(`FAILSAFE CONCERNED — ${Math.round(minutesSince / 60)}h since contact`);
      this.lastFailsafeAction = now;
      this.handleWake('failsafe_concerned');
    } else if (minutesSince > this.failsafeGentle) {
      // 2+ hours — gentle check-in
      olog(`FAILSAFE gentle — ${Math.round(minutesSince)}min since contact`);
      this.lastFailsafeAction = now;
      this.handleWake('failsafe_gentle');
    }
  }

  // --- Timer polling ---

  private async checkTimers(): Promise<void> {
    const now = new Date().toISOString();
    const dueTimers = getDueTimers(now);

    for (const timer of dueTimers) {
      try {
        markTimerFired(timer.id, now);

        // Build reminder message
        let content = `**Reminder: ${timer.label}**`;
        if (timer.context) {
          content += `\n_Context: ${timer.context}_`;
        }

        // Post reminder as companion message
        const message = createMessage({
          id: crypto.randomUUID(),
          threadId: timer.thread_id,
          role: 'companion',
          content,
          metadata: { source: 'timer', timerId: timer.id },
          createdAt: now,
        });

        updateThreadActivity(timer.thread_id, now, true);
        registry.broadcast({ type: 'message', message });

        // Push notification for timers — always send (time-critical)
        if (this.pushService) {
          this.pushService.sendAlways({
            title: 'Reminder',
            body: timer.label,
            threadId: timer.thread_id,
            tag: `timer-${timer.id}`,
            url: '/chat',
          }).catch(err => console.error('Timer push error:', err));
        }

        olog(`TIMER FIRED: "${timer.label}" in thread ${timer.thread_id}`);

        // If prompt provided, fire autonomous wake
        if (timer.prompt) {
          if (this.agent.isProcessing()) {
            olog(`TIMER: autonomous prompt skipped (agent busy) for "${timer.label}"`);
          } else {
            const fullPrompt = `Timer reminder just fired: "${timer.label}"${timer.context ? ` (context: ${timer.context})` : ''}.\n\n${timer.prompt}`;
            this.agent.processAutonomous(timer.thread_id, fullPrompt).catch(err => {
              olog(`TIMER ERROR: autonomous prompt failed for "${timer.label}" — ${err.message || err}`);
            });
          }
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        olog(`TIMER ERROR: "${timer.label}" — ${errMsg}`);
      }
    }
  }

  // --- Trigger evaluation ---

  private async checkTriggers(): Promise<void> {
    const config = getResonantConfig();
    const timezone = config.identity.timezone;
    const triggers = getActiveTriggers();
    if (triggers.length === 0) return;

    const now = new Date();
    const presenceNow = registry.getUserPresenceState();
    const agentFree = !this.agent.isProcessing();

    // Local time in configured timezone
    const localHour = parseInt(now.toLocaleString('en-GB', { timeZone: timezone, hour: '2-digit', hour12: false }));
    const localMinute = parseInt(now.toLocaleString('en-GB', { timeZone: timezone, minute: '2-digit' }));

    // Lazy-fetch status only if any trigger needs it
    let statusText = '';
    const needsStatus = triggers.some(t => {
      const conditions: TriggerCondition[] = JSON.parse(t.conditions);
      return conditions.some(c => c.type === 'routine_missing');
    });
    if (needsStatus) {
      statusText = await fetchLifeStatus();
    }

    const ctx: TriggerContext = {
      presenceNow,
      presencePrev: this.lastUserPresenceState,
      agentFree,
      statusText,
      hour: localHour,
      minute: localMinute,
    };

    for (const trigger of triggers) {
      try {
        if (trigger.status === 'waiting') {
          // Waiting triggers: conditions already met, just need agent free
          if (agentFree) {
            await this.fireTrigger(trigger, now);
          }
          continue;
        }

        // Pending triggers: evaluate conditions
        const conditions: TriggerCondition[] = JSON.parse(trigger.conditions);

        // Watchers: check cooldown
        if (trigger.kind === 'watcher' && trigger.last_fired_at) {
          const lastFired = new Date(trigger.last_fired_at).getTime();
          const cooldownMs = (trigger.cooldown_minutes || 120) * 60 * 1000;
          if (now.getTime() - lastFired < cooldownMs) continue;
        }

        if (evaluateConditions(conditions, ctx)) {
          if (agentFree) {
            await this.fireTrigger(trigger, now);
          } else {
            // Conditions met but agent busy — mark waiting (impulses only)
            if (trigger.kind === 'impulse') {
              markTriggerWaiting(trigger.id);
              olog(`TRIGGER WAITING: "${trigger.label}" (agent busy)`);
            }
            // Watchers just skip this tick — they'll re-evaluate next time
          }
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        olog(`TRIGGER ERROR: "${trigger.label}" — ${errMsg}`);
      }
    }

    // Update presence state at end of tick
    this.lastUserPresenceState = presenceNow;
  }

  private async fireTrigger(trigger: Trigger, now: Date): Promise<void> {
    const nowIso = now.toISOString();

    // Update DB first
    if (trigger.kind === 'impulse') {
      markTriggerFired(trigger.id, nowIso);
    } else {
      markWatcherFired(trigger.id, nowIso);
    }

    const kindLabel = trigger.kind === 'impulse' ? 'Impulse' : 'Watcher';
    olog(`TRIGGER FIRED: [${kindLabel}] "${trigger.label}" (fire_count: ${trigger.fire_count + 1})`);

    // If no prompt, just log
    if (!trigger.prompt) return;

    try {
      // Get or create today's thread (use trigger's thread_id if specified,
      // but redirect stale daily threads to today's — daily threads rotate)
      let threadId = trigger.thread_id;
      if (threadId) {
        const triggerThread = getThread(threadId);
        if (triggerThread?.type === 'daily') {
          const today = getTodayThread();
          if (today && today.id !== threadId) {
            olog(`TRIGGER: redirecting from stale daily thread "${triggerThread.name}" to today's`);
            threadId = today.id;
          }
        }
      }
      if (!threadId) {
        let thread = getTodayThread();
        if (!thread) {
          const dayName = now.toLocaleDateString('en-GB', {
            weekday: 'long', month: 'short', day: 'numeric',
          });
          thread = createThread({
            id: crypto.randomUUID(),
            name: dayName,
            type: 'daily',
            createdAt: nowIso,
            sessionType: 'v1',
          });
          registry.broadcast({ type: 'thread_created', thread });
          olog(`Created daily thread: ${thread.name} (${thread.id})`);
        }
        threadId = thread.id;
      }

      const fullPrompt = `${kindLabel}: "${trigger.label}"\n\n${trigger.prompt}`;
      const response = await this.agent.processAutonomous(threadId!, fullPrompt);
      updateThreadActivity(threadId!, nowIso, true);
      olog(`TRIGGER DONE: "${trigger.label}" (${response.length} chars)`);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      olog(`TRIGGER FIRE ERROR: "${trigger.label}" — ${errMsg}`);
    }
  }

  // --- Helpers ---

  private shouldSkipCheckIn(): boolean {
    // Skip only if agent is currently processing (we're already mid-conversation)
    // Decision-point wakes handle user presence state in their own prompts —
    // the companion reads the room and decides whether to reach out or do its own thing
    return this.agent.isProcessing();
  }
}
