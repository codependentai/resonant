// DiscordService — Gateway listener that routes Discord messages through AgentService

import {
  Client,
  GatewayIntentBits,
  Events,
  Partials,
} from 'discord.js';
import type { Message as DiscordMessage, TextChannel } from 'discord.js';
import crypto from 'crypto';
import { MessageDebouncer } from './debouncer.js';
import { preflight } from './preflight.js';
import { PairingService } from './pairing.js';
import { getUserRule } from './rules.js';
import { buildRulesContext } from './rules.js';
import { DISCORD_CONFIG, getDiscordConfig } from './config.js';
import { splitResponse, formatChannelHistory, getDiscordThreadId } from './utils.js';
import type { MessageBatch } from './types.js';
import type { AgentService } from '../agent.js';
import { createMessage, createThread, getThread, getMostRecentActiveThread, updateThreadActivity } from '../db.js';
import { getResonantConfig } from '../../config.js';
import type { registry as registryInstance } from '../ws.js';

type ConnectionRegistry = typeof registryInstance;

// Module-level activity tracker — records last message per Discord user
interface ActivityEntry {
  name: string;
  lastSeen: number;
  channelId: string;
}

const recentActivity = new Map<string, ActivityEntry>();

export function getDiscordActivity(): Map<string, ActivityEntry> {
  return recentActivity;
}

export class DiscordService {
  private client: Client;
  private debouncer: MessageDebouncer;
  private pairingService: PairingService;
  private agentService: AgentService;
  private registry: ConnectionRegistry;
  private processing = new Set<string>();
  private started = false;

  // Deferred queue — holds non-owner Discord batches when owner is active on web UI
  private deferredBatches: Array<{ batch: MessageBatch; queuedAt: number }> = [];
  private deferTimer: ReturnType<typeof setInterval> | null = null;

  // Stats
  private stats = {
    messagesReceived: 0,
    messagesProcessed: 0,
    deferred: 0,
    errors: 0,
    startedAt: Date.now(),
  };

  constructor(agentService: AgentService, registry: ConnectionRegistry) {
    this.agentService = agentService;
    this.registry = registry;
    this.pairingService = new PairingService();

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
      ],
      partials: [
        Partials.Channel,
        Partials.Message,
      ],
    });

    this.debouncer = new MessageDebouncer();
    this.debouncer.onBatch(this.handleBatch.bind(this));

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.client.on(Events.MessageCreate, (message: DiscordMessage) => {
      // Ignore own messages
      if (message.author.id === this.client.user?.id) return;

      // Ignore unknown bots — allow bots with UserRules
      if (message.author.bot) {
        const botRule = getUserRule(message.author.id);
        if (!botRule) return;
        console.log(`[Discord] Known bot message: ${botRule.name}`);
      }

      this.stats.messagesReceived++;
      this.debouncer.add(message);
    });

    this.client.on(Events.ClientReady, (c) => {
      console.log(`[Discord] Logged in as ${c.user.tag}`);
      console.log(`[Discord] Guilds: ${c.guilds.cache.size}`);
    });

    this.client.on('error', (error) => {
      console.error('[Discord] Client error:', error);
    });

    this.client.on('warn', (msg) => {
      console.warn('[Discord] Warning:', msg);
    });

    this.client.on(Events.ShardDisconnect, (event, shardId) => {
      console.error(`[Discord] Shard ${shardId} disconnected (code ${event.code})`);
    });

    this.client.on(Events.ShardReconnecting, (shardId) => {
      console.log(`[Discord] Shard ${shardId} reconnecting...`);
    });

    this.client.on(Events.ShardResume, (shardId, replayedEvents) => {
      console.log(`[Discord] Shard ${shardId} resumed (${replayedEvents} events replayed)`);
    });
  }

  private async handleBatch(batch: MessageBatch): Promise<void> {
    const { firstMessage, lastMessage, channelId, userId } = batch;
    const isOwner = userId === DISCORD_CONFIG.ownerUserId;

    // Defer non-owner Discord messages when owner is actively chatting on web UI
    // This prevents Discord conversations from interrupting the owner's flow
    // Uses web-specific activity — Telegram activity should NOT trigger deferral
    if (!isOwner) {
      const ownerActiveMinutes = this.registry.minutesSinceLastUserWebActivity();
      if (ownerActiveMinutes < getDiscordConfig().ownerActiveThresholdMin) {
        this.deferredBatches.push({ batch, queuedAt: Date.now() });
        this.stats.deferred++;
        lastMessage.react('\u23F3').catch(() => {}); // hourglass — message seen but delayed
        console.log(`[Discord] Deferred message from ${firstMessage.author.username} (owner active ${ownerActiveMinutes.toFixed(1)}m ago, ${this.deferredBatches.length} in queue)`);
        return;
      }
    }

    await this._processBatch(batch);
  }

  private async _processBatch(batch: MessageBatch): Promise<void> {
    const { firstMessage, lastMessage, channelId, userId } = batch;
    const isOwner = userId === DISCORD_CONFIG.ownerUserId;
    const key = `${channelId}:${userId}`;

    if (this.processing.has(key)) {
      console.log(`[Discord] Already processing ${key}, skipping`);
      return;
    }

    this.processing.add(key);

    // Track activity for relational field context
    recentActivity.set(userId, {
      name: firstMessage.author.username,
      lastSeen: Date.now(),
      channelId,
    });

    let typingInterval: ReturnType<typeof setInterval> | null = null;

    try {
      // Run preflight checks
      const result = await preflight(batch, this.pairingService);

      if (!result.allowed) {
        console.log(`[Discord] Preflight denied: ${result.reason}`);

        if (result.requiresPairing && result.pairingCode) {
          const config = getResonantConfig();
          await lastMessage.reply(
            `I don't recognize you yet. To chat with me, ask ${config.identity.user_name} to approve this code: \`${result.pairingCode}\`\n\nThis code expires in 1 hour.`
          );
        }
        return;
      }

      // Touch owner's activity if they're the sender
      if (isOwner) {
        this.registry.touchUserActivity();
      }

      // Show typing indicator (refresh every 8s — Discord typing expires after 10s)
      if ('sendTyping' in lastMessage.channel) {
        await lastMessage.channel.sendTyping();
      }
      typingInterval = setInterval(() => {
        if ('sendTyping' in lastMessage.channel) {
          (lastMessage.channel as TextChannel).sendTyping().catch(() => {});
        }
      }, 8000);

      console.log(`[Discord] Processing from ${firstMessage.author.username} in ${channelId}`);

      // Pre-fetch channel history (25 messages)
      try {
        const channel = lastMessage.channel;
        if ('messages' in channel) {
          const history = await (channel as TextChannel).messages.fetch({ limit: 25 });
          batch.channelHistory = formatChannelHistory([...history.values()].reverse());
        }
      } catch (err) {
        console.warn('[Discord] Could not fetch channel history:', err);
      }

      // Resolve thread — owner routes to their active web session, others get channel-mapped threads
      let threadId: string;
      let threadName: string;

      if (isOwner) {
        // Owner's messages go to their most recently active web thread
        // This gives the companion full context from the web conversation
        const activeThread = getMostRecentActiveThread();
        if (activeThread) {
          threadId = activeThread.id;
          threadName = activeThread.name;
          console.log(`[Discord] Owner routed to active web thread: ${threadName} (${threadId})`);
        } else {
          // No active web thread — fall back to channel-mapped thread
          threadId = getDiscordThreadId(channelId);
          threadName = batch.guildId
            ? `#${(this.client.channels.cache.get(channelId) as TextChannel)?.name || channelId} (${this.client.guilds.cache.get(batch.guildId)?.name || batch.guildId})`
            : `DM: ${firstMessage.author.username}`;
          console.log(`[Discord] No active web thread — owner using Discord thread: ${threadName}`);
        }
      } else {
        // Everyone else gets deterministic channel-mapped threads
        threadId = getDiscordThreadId(channelId);
        if (batch.guildId) {
          const guild = this.client.guilds.cache.get(batch.guildId);
          const channel = this.client.channels.cache.get(channelId);
          const channelName = channel && 'name' in channel ? (channel as TextChannel).name : channelId;
          const guildName = guild?.name || batch.guildId;
          threadName = `#${channelName} (${guildName})`;
        } else {
          threadName = `DM: ${firstMessage.author.username}`;
        }
      }

      // Ensure thread exists in SQLite
      let thread = getThread(threadId);
      if (!thread) {
        thread = createThread({
          id: threadId,
          name: threadName,
          type: 'named',
          createdAt: new Date().toISOString(),
          sessionType: 'v1',
        });
        console.log(`[Discord] Created thread: ${threadName} (${threadId})`);
      }

      // Store incoming message in SQLite
      const now = new Date().toISOString();
      const senderRole = isOwner ? 'user' : 'system';
      const incomingMsg = createMessage({
        id: crypto.randomUUID(),
        threadId,
        role: senderRole as 'user' | 'system',
        content: batch.combinedContent,
        contentType: 'text',
        platform: 'discord',
        metadata: {
          discordUserId: userId,
          discordUsername: firstMessage.author.username,
          discordChannelId: channelId,
          discordGuildId: batch.guildId,
          discordMessageId: lastMessage.id,
        },
        createdAt: now,
      });

      updateThreadActivity(threadId, now, true);
      this.registry.broadcast({ type: 'message', message: incomingMsg });

      // Build platform context (platform info + rules + channel history)
      const platformHeader = batch.guildId
        ? `=== PLATFORM: DISCORD ===\nResponding in #${(this.client.channels.cache.get(channelId) as TextChannel)?.name || channelId} on ${this.client.guilds.cache.get(batch.guildId)?.name || batch.guildId}.`
        : `=== PLATFORM: DISCORD ===\nResponding in DM with ${firstMessage.author.username}.`;
      const platformGuidance = [
        platformHeader,
        'Discord formatting: **bold**, *italic*, `code`, ```codeblocks```, > quotes, ||spoilers||.',
        'Max message length: 2000 chars (responses auto-split at 1900).',
        'Replying to the last message in this batch.',
        'Keep responses appropriate to the platform — not as terse as Telegram, but don\'t write essays.',
      ].join('\n');

      const rulesContext = buildRulesContext(userId, channelId, batch.guildId);
      const historyContext = batch.channelHistory
        ? `\n\n=== RECENT CHANNEL HISTORY (last 25 messages) ===\n${batch.channelHistory}`
        : '';
      const platformContext = `${platformGuidance}\n\n${rulesContext}${historyContext}`;

      this.stats.messagesProcessed++;

      // Process through AgentService
      const response = await this.agentService.processMessage(
        threadId,
        batch.combinedContent,
        { name: threadName, type: 'named' },
        { platform: 'discord', platformContext },
      );

      if (!response || response.trim() === '' || response === '[No response]') {
        console.log('[Discord] Empty response from agent');
        return;
      }

      // Split and send response with rate limit delay
      const chunks = splitResponse(response, 1900);

      for (let i = 0; i < chunks.length; i++) {
        if (i === 0) {
          await lastMessage.reply(chunks[i]);
        } else {
          // 200ms delay between chunks to avoid rate limits
          await new Promise(r => setTimeout(r, 200));
          if ('send' in lastMessage.channel) {
            await (lastMessage.channel as TextChannel).send(chunks[i]);
          }
        }
      }

      console.log(`[Discord] Sent ${chunks.length} chunk(s) to ${channelId}`);

    } catch (error) {
      console.error('[Discord] Handler error:', error);
      this.stats.errors++;
    } finally {
      if (typingInterval) clearInterval(typingInterval);
      this.processing.delete(key);
    }
  }

  private async drainDeferredQueue(): Promise<void> {
    if (this.deferredBatches.length === 0) return;

    const config = getDiscordConfig();
    const ownerActiveMinutes = this.registry.minutesSinceLastUserWebActivity();
    if (ownerActiveMinutes < config.ownerActiveThresholdMin) return; // Owner still active on web — keep holding

    // Prune expired batches
    const now = Date.now();
    this.deferredBatches = this.deferredBatches.filter(entry => {
      if (now - entry.queuedAt > config.deferMaxAgeMs) {
        console.log(`[Discord] Dropping expired deferred batch from ${entry.batch.firstMessage.author.username}`);
        return false;
      }
      return true;
    });

    if (this.deferredBatches.length === 0) return;

    console.log(`[Discord] Owner idle ${ownerActiveMinutes.toFixed(1)}m — draining ${this.deferredBatches.length} deferred messages`);

    // Process one at a time to avoid flooding
    while (this.deferredBatches.length > 0) {
      // Re-check owner's web activity before each batch — stop draining if they come back to web
      if (this.registry.minutesSinceLastUserWebActivity() < config.ownerActiveThresholdMin) {
        console.log(`[Discord] Owner returned — pausing drain (${this.deferredBatches.length} remaining)`);
        break;
      }
      const entry = this.deferredBatches.shift()!;
      await this._processBatch(entry.batch);
    }
  }

  async start(): Promise<void> {
    const token = process.env.DISCORD_BOT_TOKEN;
    if (!token) {
      console.error('[Discord] DISCORD_BOT_TOKEN not set — gateway disabled');
      return;
    }

    try {
      await this.client.login(token);
      this.started = true;

      // Start deferred queue drain timer
      this.deferTimer = setInterval(() => {
        this.drainDeferredQueue().catch(err =>
          console.error('[Discord] Drain error:', err)
        );
      }, getDiscordConfig().deferPollIntervalMs);

      console.log('[Discord] Gateway started');
    } catch (error) {
      console.error('[Discord] Failed to login:', error);
    }
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    console.log('[Discord] Shutting down gateway...');
    if (this.deferTimer) {
      clearInterval(this.deferTimer);
      this.deferTimer = null;
    }
    this.deferredBatches = [];
    this.debouncer.destroy();
    this.client.destroy();
    this.started = false;
  }

  isConnected(): boolean {
    return this.started && this.client.isReady();
  }

  getStats() {
    return {
      ...this.stats,
      deferredPending: this.deferredBatches.length,
      connected: this.isConnected(),
      username: this.client.user?.username || null,
      guilds: this.client.guilds.cache.size,
    };
  }

  getPairingService(): PairingService {
    return this.pairingService;
  }
}
