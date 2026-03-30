import { Router } from 'express';
import crypto from 'crypto';
import multer from 'multer';
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join, basename, resolve } from 'path';
import yaml from 'js-yaml';
import {
  listThreads,
  getThread,
  createThread,
  createMessage,
  getMessages,
  markMessagesRead,
  getMessage,
  archiveThread,
  deleteThread,
  updateThreadActivity,
  getDb,
  getAllConfig,
  setConfig,
  getConfigBool,
  createCanvas,
  getCanvas,
  listCanvases,
  updateCanvasContent,
  updateCanvasTitle,
  deleteCanvas,
  createTimer,
  listPendingTimers,
  cancelTimer,
  addPushSubscription,
  removePushSubscription,
  listPushSubscriptions,
  searchMessages,
  pinThread,
  unpinThread,
  addReaction,
  removeReaction,
  createTrigger,
  listTriggers,
  cancelTrigger,
  getUnembeddedMessages,
  saveEmbedding,
  getEmbeddingCount,
  getMessageContext,
} from '../services/db.js';
import type { TriggerCondition } from '../services/db.js';
import {
  loginHandler,
  logoutHandler,
  sessionCheckHandler,
} from '../middleware/auth.js';
import { loginRateLimiter } from '../middleware/security.js';
import { authMiddleware } from '../middleware/auth.js';
import { getRecentAuditEntries } from '../services/audit.js';
import { embed, vectorToBuffer } from '../services/embeddings.js';
import { searchVectors, getCacheStats, type SearchFilter } from '../services/vector-cache.js';
import { saveFile, saveFileInternal, getContentTypeFromMime, getFile, deleteFile, listFiles } from '../services/files.js';
import { registry } from '../services/ws.js';
import { getResonantConfig } from '../config.js';
import type { Orchestrator } from '../services/orchestrator.js';
import type { VoiceService } from '../services/voice.js';
import type { TelegramService } from '../services/telegram/index.js';
import type { PushService } from '../services/push.js';
import rateLimit from 'express-rate-limit';
// CC routes imported lazily below (after config loads)

const router = Router();

// --- Public routes (no auth) ---

// Health check (public — minimal response)
router.get('/health', (req, res) => {
  const mem = process.memoryUsage();
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    memoryUsage: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal },
    connections: req.app.locals.agentService ? 0 : 0,
  });
});

// Auth endpoints
router.get('/auth/check', sessionCheckHandler);
router.post('/auth/login', loginRateLimiter, loginHandler);
router.post('/auth/logout', logoutHandler);

// Push VAPID public key (no auth — needed before subscription)
router.get('/push/vapid-public', (req, res) => {
  const pushService = req.app.locals.pushService as PushService | undefined;
  const publicKey = pushService?.getVapidPublicKey() || null;
  res.json({ publicKey });
});

// Identity endpoint — companion/user names and timezone for frontend personalization
router.get('/identity', (req, res) => {
  const config = getResonantConfig();
  res.json({
    companion_name: config.identity.companion_name,
    user_name: config.identity.user_name,
    timezone: config.identity.timezone,
  });
});

// --- Internal routes (localhost-only, no auth) ---

// TTS endpoint — companion sends voice notes via curl from localhost
router.post('/internal/tts', async (req, res) => {
  // Localhost-only guard
  const ip = req.socket.remoteAddress || '';
  const isLocalhost = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  if (!isLocalhost) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }

  const { text, threadId: explicitThreadId } = req.body;
  if (!text) {
    res.status(400).json({ error: 'text is required' });
    return;
  }

  const voiceService = req.app.locals.voiceService as VoiceService | undefined;
  if (!voiceService?.canTTS) {
    res.status(500).json({ error: 'ElevenLabs not configured — set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID in .env' });
    return;
  }

  // If threadId not provided, use the most recently active thread
  let threadId = explicitThreadId;
  if (!threadId) {
    const threads = listThreads({ includeArchived: false, limit: 1 });
    if (threads.length === 0) {
      res.status(404).json({ error: 'No active threads found' });
      return;
    }
    threadId = threads[0].id;
  }

  const thread = getThread(threadId);
  if (!thread) {
    res.status(404).json({ error: 'Thread not found' });
    return;
  }

  try {
    const result = await voiceService.generateTTSForMessage(text, threadId);
    res.json({ success: true, messageId: result.messageId, fileId: result.fileId });
  } catch (error) {
    console.error('TTS error:', error);
    const msg = error instanceof Error ? error.message : 'TTS generation failed';
    res.status(500).json({ error: msg });
  }
});

// Share a file into chat — companion shares files from disk into a thread
router.post('/internal/share', (req, res) => {
  // Localhost-only guard
  const ip = req.socket.remoteAddress || '';
  const isLocalhost = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  if (!isLocalhost) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }

  const { path: filePath, threadId: explicitThreadId, caption } = req.body;
  if (!filePath || typeof filePath !== 'string') {
    res.status(400).json({ error: 'path is required' });
    return;
  }

  if (!existsSync(filePath)) {
    res.status(404).json({ error: 'File not found on disk' });
    return;
  }

  // Resolve thread
  let threadId = explicitThreadId;
  if (!threadId) {
    const threads = listThreads({ includeArchived: false, limit: 1 });
    if (threads.length === 0) {
      res.status(404).json({ error: 'No active threads found' });
      return;
    }
    threadId = threads[0].id;
  }

  const thread = getThread(threadId);
  if (!thread) {
    res.status(404).json({ error: 'Thread not found' });
    return;
  }

  try {
    const buffer = readFileSync(filePath);
    const filename = basename(filePath);
    const fileMeta = saveFileInternal(buffer, filename);

    const now = new Date().toISOString();
    const message = createMessage({
      id: crypto.randomUUID(),
      threadId,
      role: 'companion',
      content: caption || fileMeta.url,
      contentType: fileMeta.contentType,
      metadata: { fileId: fileMeta.fileId, filename: fileMeta.filename, size: fileMeta.size, source: 'shared' },
      createdAt: now,
    });

    updateThreadActivity(threadId, now, true);
    registry.broadcast({ type: 'message', message });

    res.json({ success: true, fileId: fileMeta.fileId, messageId: message.id, url: fileMeta.url });
  } catch (error) {
    console.error('Share file error:', error);
    const msg = error instanceof Error ? error.message : 'Failed to share file';
    res.status(500).json({ error: msg });
  }
});

// Telegram send — send files/photos/voice to user via Telegram
router.post('/internal/telegram-send', async (req, res) => {
  const ip = req.socket.remoteAddress || '';
  const isLocalhost = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  if (!isLocalhost) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }

  const telegramService = req.app.locals.telegramService as TelegramService | undefined;
  if (!telegramService?.isConnected()) {
    res.status(503).json({ error: 'Telegram not connected' });
    return;
  }

  const { type, text, path: filePath, url, caption, filename, query, target, emoji } = req.body;

  try {
    switch (type) {
      case 'text':
        if (!text) { res.status(400).json({ error: 'text is required' }); return; }
        await telegramService.sendToOwner(text);
        break;

      case 'voice':
        if (!text) { res.status(400).json({ error: 'text is required for TTS' }); return; }
        await telegramService.sendVoiceToOwner(text);
        break;

      case 'photo': {
        const source = url || (filePath && existsSync(filePath) ? readFileSync(filePath) : null);
        if (!source) { res.status(400).json({ error: 'url or valid path required' }); return; }
        await telegramService.sendPhotoToOwner(source, caption);
        break;
      }

      case 'document': {
        const docSource = url || (filePath && existsSync(filePath) ? readFileSync(filePath) : null);
        if (!docSource) { res.status(400).json({ error: 'url or valid path required' }); return; }
        await telegramService.sendDocumentToOwner(docSource, filename || basename(filePath || 'file'), caption);
        break;
      }

      case 'animation': {
        const animSource = url || (filePath && existsSync(filePath) ? readFileSync(filePath) : null);
        if (!animSource) { res.status(400).json({ error: 'url or valid path required' }); return; }
        await telegramService.sendAnimationToOwner(animSource, caption);
        break;
      }

      case 'gif':
        if (!query) { res.status(400).json({ error: 'query is required for gif search' }); return; }
        await telegramService.sendGifToOwner(query, caption);
        break;

      case 'react':
        if (!target || !emoji) { res.status(400).json({ error: 'target and emoji are required' }); return; }
        await telegramService.reactToMessage(target, emoji);
        break;

      default:
        res.status(400).json({ error: `Unknown type: ${type}. Use text, voice, photo, document, animation, gif, or react.` });
        return;
    }

    res.json({ success: true, type });
  } catch (error) {
    console.error('[API] Telegram send error:', error);
    const msg = error instanceof Error ? error.message : 'Telegram send failed';
    res.status(500).json({ error: msg });
  }
});

// Canvas — internal endpoint for agent to create/update canvases
router.post('/internal/canvas', (req, res) => {
  const ip = req.socket.remoteAddress || '';
  const isLocalhost = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  if (!isLocalhost) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }

  const config = getResonantConfig();
  const { action, canvasId, title, content, filePath, contentType, language, threadId } = req.body;
  const now = new Date().toISOString();

  // Resolve content: filePath takes priority over inline content
  let resolvedContent = content || '';
  if (filePath && typeof filePath === 'string') {
    if (!existsSync(filePath)) {
      res.status(404).json({ error: 'File not found on disk' });
      return;
    }
    resolvedContent = readFileSync(filePath, 'utf-8');
  }

  try {
    if (action === 'create') {
      if (!title) {
        res.status(400).json({ error: 'title is required' });
        return;
      }

      const canvas = createCanvas({
        id: crypto.randomUUID(),
        threadId: threadId || undefined,
        title,
        content: resolvedContent,
        contentType: contentType || 'markdown',
        language: language || undefined,
        createdBy: 'companion',
        createdAt: now,
      });

      registry.broadcast({ type: 'canvas_created', canvas });

      // System message in chat if threadId provided
      if (threadId) {
        const thread = getThread(threadId);
        if (thread) {
          const sysMsg = createMessage({
            id: crypto.randomUUID(),
            threadId,
            role: 'system',
            content: `${config.identity.companion_name} opened a canvas: ${title}`,
            createdAt: now,
          });
          registry.broadcast({ type: 'message', message: sysMsg });
        }
      }

      res.json({ success: true, canvas });
    } else if (action === 'update') {
      if (!canvasId || (resolvedContent === '' && !filePath)) {
        res.status(400).json({ error: 'canvasId and content (or filePath) are required' });
        return;
      }
      updateCanvasContent(canvasId, resolvedContent, now);
      registry.broadcast({ type: 'canvas_updated', canvasId, content: resolvedContent, updatedAt: now });
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Unknown action. Use "create" or "update".' });
    }
  } catch (error) {
    console.error('Internal canvas error:', error);
    res.status(500).json({ error: 'Canvas operation failed' });
  }
});

// Orchestrator self-management — companion manages schedule via curl
router.post('/internal/orchestrator', async (req, res) => {
  const ip = req.socket.remoteAddress || '';
  const isLocalhost = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  if (!isLocalhost) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }

  const orchestrator = req.app.locals.orchestrator as Orchestrator | undefined;
  if (!orchestrator) {
    res.status(503).json({ error: 'Orchestrator not available' });
    return;
  }

  const { action, wakeType, cronExpr, label, prompt, enabled, gentle, concerned, emergency, frequency } = req.body;

  try {
    switch (action) {
      case 'status': {
        const tasks = await orchestrator.getStatus();
        res.json({ tasks });
        break;
      }
      case 'enable': {
        if (!wakeType) { res.status(400).json({ error: 'wakeType required' }); return; }
        const success = orchestrator.enableTask(wakeType);
        if (!success) { res.status(404).json({ error: 'Unknown wake type' }); return; }
        res.json({ success: true, wakeType, enabled: true });
        break;
      }
      case 'disable': {
        if (!wakeType) { res.status(400).json({ error: 'wakeType required' }); return; }
        const success = orchestrator.disableTask(wakeType);
        if (!success) { res.status(404).json({ error: 'Unknown wake type' }); return; }
        res.json({ success: true, wakeType, enabled: false });
        break;
      }
      case 'reschedule': {
        if (!wakeType || !cronExpr) { res.status(400).json({ error: 'wakeType and cronExpr required' }); return; }
        const success = orchestrator.rescheduleTask(wakeType, cronExpr);
        if (!success) { res.status(400).json({ error: 'Failed — invalid cron or unknown wake type' }); return; }
        res.json({ success: true, wakeType, cronExpr });
        break;
      }
      case 'create_routine': {
        if (!wakeType || !cronExpr || !label) { res.status(400).json({ error: 'wakeType, label, and cronExpr required' }); return; }
        const crSuccess = orchestrator.addRoutine({ wakeType, label, cronExpr, prompt: prompt || `Custom routine: ${label}` });
        if (!crSuccess) { res.status(400).json({ error: 'Failed — invalid cron, missing prompt, or wakeType already exists' }); return; }
        res.json({ success: true, wakeType, label, cronExpr });
        break;
      }
      case 'remove_routine': {
        if (!wakeType) { res.status(400).json({ error: 'wakeType required' }); return; }
        const rrSuccess = orchestrator.removeRoutine(wakeType);
        if (!rrSuccess) { res.status(400).json({ error: 'Failed — unknown routine or cannot remove default task' }); return; }
        res.json({ success: true, wakeType });
        break;
      }
      case 'pulse_status': {
        res.json(orchestrator.getPulseConfig());
        break;
      }
      case 'pulse_config': {
        orchestrator.setPulseConfig({ enabled, frequency });
        res.json({ success: true, ...orchestrator.getPulseConfig() });
        break;
      }
      case 'failsafe_status': {
        res.json(orchestrator.getFailsafeConfig());
        break;
      }
      case 'failsafe_config': {
        orchestrator.setFailsafeConfig({ enabled, gentle, concerned, emergency });
        res.json({ success: true, ...orchestrator.getFailsafeConfig() });
        break;
      }
      default:
        res.status(400).json({ error: 'Unknown action. Use: status, enable, disable, reschedule, create_routine, remove_routine, pulse_status, pulse_config, failsafe_status, failsafe_config' });
    }
  } catch (error) {
    console.error('Orchestrator internal error:', error);
    res.status(500).json({ error: 'Orchestrator operation failed' });
  }
});

// Timer/Reminder — companion sets contextual reminders via curl
router.post('/internal/timer', (req, res) => {
  const ip = req.socket.remoteAddress || '';
  const isLocalhost = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  if (!isLocalhost) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }

  const { action } = req.body;

  try {
    switch (action) {
      case 'create': {
        const { label, fireAt, threadId, context, prompt } = req.body;
        if (!label || !fireAt || !threadId) {
          res.status(400).json({ error: 'label, fireAt, and threadId required' });
          return;
        }

        // Validate fireAt is a valid ISO date
        const fireDate = new Date(fireAt);
        if (isNaN(fireDate.getTime())) {
          res.status(400).json({ error: 'fireAt must be a valid ISO date' });
          return;
        }

        // Validate thread exists
        const thread = getThread(threadId);
        if (!thread) {
          res.status(404).json({ error: 'Thread not found' });
          return;
        }

        const timer = createTimer({
          id: crypto.randomUUID(),
          label,
          context,
          fireAt: fireDate.toISOString(),
          threadId,
          prompt,
          createdAt: new Date().toISOString(),
        });

        res.json({ success: true, timer });
        break;
      }
      case 'list': {
        const timers = listPendingTimers();
        res.json({ timers });
        break;
      }
      case 'cancel': {
        const { timerId } = req.body;
        if (!timerId) {
          res.status(400).json({ error: 'timerId required' });
          return;
        }
        const cancelled = cancelTimer(timerId);
        if (!cancelled) {
          res.status(404).json({ error: 'Timer not found or already fired/cancelled' });
          return;
        }
        res.json({ success: true, timerId });
        break;
      }
      default:
        res.status(400).json({ error: 'Unknown action. Use: create, list, cancel' });
    }
  } catch (error) {
    console.error('Timer internal error:', error);
    res.status(500).json({ error: 'Timer operation failed' });
  }
});

// Trigger management (internal — agent use via CLI)
router.post('/internal/trigger', (req, res) => {
  const ip = req.socket.remoteAddress || '';
  const isLocalhost = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  if (!isLocalhost) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }

  const { action } = req.body;

  try {
    switch (action) {
      case 'create': {
        const { kind, label, conditions, prompt, threadId, cooldownMinutes } = req.body;
        if (!kind || !label || !conditions) {
          res.status(400).json({ error: 'kind, label, and conditions required' });
          return;
        }
        if (kind !== 'impulse' && kind !== 'watcher') {
          res.status(400).json({ error: 'kind must be "impulse" or "watcher"' });
          return;
        }
        if (!Array.isArray(conditions) || conditions.length === 0) {
          res.status(400).json({ error: 'conditions must be a non-empty array' });
          return;
        }

        // Validate thread exists if specified
        if (threadId) {
          const thread = getThread(threadId);
          if (!thread) {
            res.status(404).json({ error: 'Thread not found' });
            return;
          }
        }

        const trigger = createTrigger({
          id: crypto.randomUUID(),
          kind,
          label,
          conditions: conditions as TriggerCondition[],
          prompt,
          threadId,
          cooldownMinutes: cooldownMinutes ? parseInt(cooldownMinutes, 10) : undefined,
          createdAt: new Date().toISOString(),
        });

        res.json({ success: true, trigger });
        break;
      }
      case 'list': {
        const { kind } = req.body;
        const triggers = listTriggers(kind);
        res.json({ triggers });
        break;
      }
      case 'cancel': {
        const { triggerId } = req.body;
        if (!triggerId) {
          res.status(400).json({ error: 'triggerId required' });
          return;
        }
        const cancelled = cancelTrigger(triggerId);
        if (!cancelled) {
          res.status(404).json({ error: 'Trigger not found or already fired/cancelled' });
          return;
        }
        res.json({ success: true, triggerId });
        break;
      }
      default:
        res.status(400).json({ error: 'Unknown action. Use: create, list, cancel' });
    }
  } catch (error) {
    console.error('Trigger internal error:', error);
    res.status(500).json({ error: 'Trigger operation failed' });
  }
});

// React to a message (internal — agent use via CLI)
router.post('/internal/react', (req, res) => {
  const ip = req.socket.remoteAddress || '';
  const isLocalhost = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  if (!isLocalhost) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }

  try {
    let { messageId, emoji, action, threadId, target } = req.body;
    if (!emoji) {
      res.status(400).json({ error: 'emoji required' });
      return;
    }

    // Resolve target shorthand: "last", "last-2", "last-3" etc.
    if (!messageId && threadId && target) {
      const offset = target === 'last' ? 0 : parseInt(target.replace('last-', ''), 10) - 1;
      if (isNaN(offset) || offset < 0) {
        res.status(400).json({ error: 'Invalid target. Use "last", "last-2", "last-3" etc.' });
        return;
      }
      const msgs = getMessages({ threadId, limit: offset + 5 });
      // msgs is chronological (oldest first), we want from the end
      const idx = msgs.length - 1 - offset;
      if (idx < 0) {
        res.status(404).json({ error: 'No message at that position' });
        return;
      }
      messageId = msgs[idx].id;
    }

    if (!messageId) {
      res.status(400).json({ error: 'messageId or (threadId + target) required' });
      return;
    }

    if (action === 'remove') {
      removeReaction(messageId, emoji, 'companion');
      registry.broadcast({
        type: 'message_reaction_removed',
        messageId,
        emoji,
        user: 'companion',
      });
    } else {
      addReaction(messageId, emoji, 'companion');
      registry.broadcast({
        type: 'message_reaction_added',
        messageId,
        emoji,
        user: 'companion',
        createdAt: new Date().toISOString(),
      });
    }

    res.json({ success: true, messageId });
  } catch (error) {
    console.error('React internal error:', error);
    res.status(500).json({ error: 'React operation failed' });
  }
});

// --- Semantic search (localhost-only, pre-auth) ---

router.post('/internal/search-semantic', async (req, res) => {
  const ip = req.socket.remoteAddress || '';
  const isLocalhost = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  if (!isLocalhost) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }

  try {
    const { query, threadId, role, after, before, limit = 10 } = req.body as {
      query?: string; threadId?: string; role?: string;
      after?: string; before?: string; limit?: number;
    };
    if (!query || typeof query !== 'string') {
      res.status(400).json({ error: 'query is required' });
      return;
    }

    const queryVector = await embed(query);

    const filter: SearchFilter = {};
    if (threadId) filter.threadId = threadId;
    if (role) filter.role = role;
    if (after) filter.after = after;
    if (before) filter.before = before;

    const topResults = searchVectors(queryVector, Math.min(limit, 50), filter);
    const contextSize = Math.min((req.body as Record<string, unknown>).context as number || 2, 10);

    const sessionStmt = getDb().prepare(`
      SELECT sh.session_id, sh.started_at, sh.ended_at
      FROM session_history sh
      WHERE sh.thread_id = ? AND sh.started_at <= ? AND (sh.ended_at IS NULL OR sh.ended_at >= ?)
      LIMIT 1
    `);

    const results = topResults.map(r => {
      const surrounding = getMessageContext(r.messageId, contextSize);

      let session: { sessionId: string; startedAt: string; endedAt: string | null } | null = null;
      try {
        const row = sessionStmt.get(r.threadId, r.createdAt, r.createdAt) as {
          session_id: string; started_at: string; ended_at: string | null;
        } | undefined;
        if (row) session = { sessionId: row.session_id, startedAt: row.started_at, endedAt: row.ended_at };
      } catch { /* best-effort */ }

      return {
        messageId: r.messageId,
        threadId: r.threadId,
        threadName: r.threadName,
        similarity: Math.round(r.similarity * 1000) / 1000,
        createdAt: r.createdAt,
        role: r.role,
        session,
        context: surrounding.map(m => ({
          id: m.id,
          role: m.role,
          content: m.content.length > 500 ? m.content.slice(0, 500) + '…' : m.content,
          createdAt: m.created_at,
          isMatch: m.id === r.messageId,
        })),
      };
    });

    const cache = getCacheStats();
    const { embedded, total } = getEmbeddingCount();
    res.json({ results, indexed: embedded, totalMessages: total, cache });
  } catch (error) {
    console.error('Semantic search error:', error);
    res.status(500).json({ error: 'Semantic search failed' });
  }
});

// Background backfill state
let backfillRunning = false;
let backfillProcessed = 0;
let backfillErrors = 0;

async function runBackfillLoop(batchSize: number, intervalMs: number): Promise<void> {
  if (backfillRunning) return;
  backfillRunning = true;
  backfillProcessed = 0;
  backfillErrors = 0;
  console.log(`[backfill] Starting background indexing (batch=${batchSize}, interval=${intervalMs}ms)`);

  const tick = async () => {
    if (!backfillRunning) return;
    const unembedded = getUnembeddedMessages(batchSize);
    if (unembedded.length === 0) {
      backfillRunning = false;
      const { embedded, total } = getEmbeddingCount();
      console.log(`[backfill] Complete. ${embedded}/${total} messages indexed (${backfillErrors} errors).`);
      return;
    }
    for (const msg of unembedded) {
      if (!backfillRunning) return;
      try {
        const vector = await embed(msg.content);
        saveEmbedding(msg.id, vectorToBuffer(vector));
        backfillProcessed++;
      } catch {
        backfillErrors++;
      }
    }
    if (backfillProcessed % 500 === 0) {
      const { embedded, total } = getEmbeddingCount();
      console.log(`[backfill] Progress: ${embedded}/${total}`);
    }
    setTimeout(tick, intervalMs);
  };
  tick();
}

router.post('/internal/embed-backfill', async (req, res) => {
  const ip = req.socket.remoteAddress || '';
  const isLocalhost = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  if (!isLocalhost) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }

  try {
    const rawBatch = req.body?.batchSize;
    const batchSize = Math.min(typeof rawBatch === 'number' ? rawBatch : 50, 200);
    const background = req.body?.background === true;
    const action = req.body?.action as string | undefined;

    if (batchSize === 0 || action === 'status') {
      const { embedded, total } = getEmbeddingCount();
      res.json({
        processed: backfillProcessed, remaining: total - embedded,
        indexed: embedded, totalMessages: total,
        running: backfillRunning, errors: backfillErrors,
      });
      return;
    }

    if (action === 'stop') {
      backfillRunning = false;
      const { embedded, total } = getEmbeddingCount();
      res.json({ stopped: true, processed: backfillProcessed, indexed: embedded, totalMessages: total });
      return;
    }

    if (background) {
      if (backfillRunning) {
        const { embedded, total } = getEmbeddingCount();
        res.json({ alreadyRunning: true, processed: backfillProcessed, indexed: embedded, totalMessages: total });
        return;
      }
      const interval = Math.max((req.body?.intervalMs as number) || 5000, 1000);
      runBackfillLoop(batchSize, interval);
      const { embedded, total } = getEmbeddingCount();
      res.json({ started: true, batchSize, intervalMs: interval, indexed: embedded, totalMessages: total });
      return;
    }

    const unembedded = getUnembeddedMessages(batchSize);
    let processed = 0;
    for (const msg of unembedded) {
      try {
        const vector = await embed(msg.content);
        saveEmbedding(msg.id, vectorToBuffer(vector));
        processed++;
      } catch (err) {
        console.error(`[backfill] Failed to embed ${msg.id}:`, err);
      }
    }

    const { embedded, total } = getEmbeddingCount();
    res.json({ processed, remaining: total - embedded, indexed: embedded, totalMessages: total });
  } catch (error) {
    console.error('Backfill error:', error);
    res.status(500).json({ error: 'Backfill failed' });
  }
});

// --- Protected routes (auth required when password is set) ---
router.use(authMiddleware);

// --- Command Center (mounted via initCcRoutes after config loads) ---

// --- Preferences (resonant.yaml) ---

function findConfigPath(): string | null {
  for (const name of ['resonant.yaml', 'resonant.yml']) {
    const p = resolve(name);
    if (existsSync(p)) return p;
  }
  return null;
}

router.get('/preferences', (req, res) => {
  try {
    const configPath = findConfigPath();
    if (!configPath) {
      res.json({ error: 'No config file found' });
      return;
    }
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = yaml.load(raw) as Record<string, unknown> || {};
    // Only expose safe, editable fields — not server internals
    const config = getResonantConfig();
    res.json({
      identity: {
        companion_name: config.identity.companion_name,
        user_name: config.identity.user_name,
        timezone: config.identity.timezone,
      },
      agent: {
        model: config.agent.model,
        model_autonomous: config.agent.model_autonomous,
      },
      orchestrator: {
        enabled: (parsed as any)?.orchestrator?.enabled ?? config.orchestrator.enabled,
      },
      voice: {
        enabled: (parsed as any)?.voice?.enabled ?? config.voice.enabled,
      },
      discord: {
        enabled: (parsed as any)?.discord?.enabled ?? config.discord.enabled,
      },
      telegram: {
        enabled: (parsed as any)?.telegram?.enabled ?? config.telegram.enabled,
      },
      auth: {
        has_password: !!config.auth.password,
      },
    });
  } catch (err) {
    console.error('Failed to read preferences:', err);
    res.status(500).json({ error: 'Failed to read preferences' });
  }
});

router.put('/preferences', (req, res) => {
  try {
    const configPath = findConfigPath();
    if (!configPath) {
      res.status(404).json({ error: 'No config file found' });
      return;
    }
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = (yaml.load(raw) as Record<string, any>) || {};
    const updates = req.body as Record<string, any>;

    // Merge only allowed fields
    if (updates.identity) {
      if (!parsed.identity) parsed.identity = {};
      if (updates.identity.companion_name !== undefined) parsed.identity.companion_name = updates.identity.companion_name;
      if (updates.identity.user_name !== undefined) parsed.identity.user_name = updates.identity.user_name;
      if (updates.identity.timezone !== undefined) parsed.identity.timezone = updates.identity.timezone;
    }
    if (updates.agent) {
      if (!parsed.agent) parsed.agent = {};
      if (updates.agent.model !== undefined) parsed.agent.model = updates.agent.model;
      if (updates.agent.model_autonomous !== undefined) parsed.agent.model_autonomous = updates.agent.model_autonomous;
    }
    if (updates.orchestrator) {
      if (!parsed.orchestrator) parsed.orchestrator = {};
      if (updates.orchestrator.enabled !== undefined) parsed.orchestrator.enabled = updates.orchestrator.enabled;
    }
    if (updates.voice) {
      if (!parsed.voice) parsed.voice = {};
      if (updates.voice.enabled !== undefined) parsed.voice.enabled = updates.voice.enabled;
    }
    if (updates.discord) {
      if (!parsed.discord) parsed.discord = {};
      if (updates.discord.enabled !== undefined) parsed.discord.enabled = updates.discord.enabled;
    }
    if (updates.telegram) {
      if (!parsed.telegram) parsed.telegram = {};
      if (updates.telegram.enabled !== undefined) parsed.telegram.enabled = updates.telegram.enabled;
    }
    if (updates.auth) {
      if (!parsed.auth) parsed.auth = {};
      if (updates.auth.password !== undefined) parsed.auth.password = updates.auth.password;
    }

    // Write back
    const newYaml = yaml.dump(parsed, { lineWidth: -1, quotingType: '"', forceQuotes: true });
    writeFileSync(configPath, newYaml, 'utf-8');

    res.json({ success: true, message: 'Preferences saved. Restart server for some changes to take effect.' });
  } catch (err) {
    console.error('Failed to save preferences:', err);
    res.status(500).json({ error: 'Failed to save preferences' });
  }
});

// On-demand TTS — user clicks "read aloud" on a companion message
router.post('/tts', async (req, res) => {
  try {
    const { text } = req.body as { text?: string };
    if (!text || typeof text !== 'string') {
      res.status(400).json({ error: 'text is required' });
      return;
    }

    const voiceService = req.app.locals.voiceService as VoiceService | undefined;
    if (!voiceService?.canTTS) {
      res.status(503).json({ error: 'TTS not configured — set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID in .env' });
      return;
    }

    // Strip markdown for cleaner speech
    const cleanText = text
      .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')  // bold/italic
      .replace(/`[^`]+`/g, '')                     // inline code
      .replace(/```[\s\S]*?```/g, '')              // code blocks
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')     // links
      .replace(/^#+\s*/gm, '')                     // headings
      .replace(/^[-*]\s+/gm, '')                   // list markers
      .replace(/\n{2,}/g, '\n')                    // excess newlines
      .trim();

    if (!cleanText) {
      res.status(400).json({ error: 'No speakable text after stripping markup' });
      return;
    }

    // Truncate to ~5000 chars (ElevenLabs limit / cost control)
    const truncated = cleanText.length > 5000 ? cleanText.slice(0, 5000) : cleanText;
    const audioBuffer = await voiceService.generateTTS(truncated);

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', audioBuffer.length.toString());
    res.send(audioBuffer);
  } catch (error) {
    console.error('TTS error:', error);
    res.status(500).json({ error: 'TTS generation failed' });
  }
});

// Thread list with summary
router.get('/threads', (req, res) => {
  try {
    const threads = listThreads({ includeArchived: false, limit: 50 });

    // Enhance with last message preview
    const db = getDb();
    const threadsWithPreview = threads.map(thread => {
      const lastMsg = db.prepare(`
        SELECT content, role, created_at
        FROM messages
        WHERE thread_id = ? AND deleted_at IS NULL
        ORDER BY sequence DESC
        LIMIT 1
      `).get(thread.id) as { content: string; role: string; created_at: string } | undefined;

      return {
        id: thread.id,
        name: thread.name,
        type: thread.type,
        unread_count: thread.unread_count,
        last_activity_at: thread.last_activity_at,
        last_message_preview: lastMsg ? {
          content: lastMsg.content.slice(0, 100) + (lastMsg.content.length > 100 ? '...' : ''),
          role: lastMsg.role,
          created_at: lastMsg.created_at,
        } : null,
        pinned_at: thread.pinned_at ?? null,
      };
    });

    res.json({ threads: threadsWithPreview });
  } catch (error) {
    console.error('Error fetching threads:', error);
    res.status(500).json({ error: 'Failed to fetch threads' });
  }
});

// Get archived threads (must be before :id routes)
router.get('/threads/archived', (req, res) => {
  try {
    const db = getDb();
    const threads = db.prepare(`
      SELECT * FROM threads WHERE archived_at IS NOT NULL
      ORDER BY archived_at DESC LIMIT 50
    `).all();
    res.json({ threads });
  } catch (error) {
    console.error('Error fetching archived threads:', error);
    res.status(500).json({ error: 'Failed to fetch archived threads' });
  }
});

// Create named thread
router.post('/threads', (req, res) => {
  try {
    const { name } = req.body;

    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'Thread name required' });
      return;
    }

    const thread = createThread({
      id: crypto.randomUUID(),
      name,
      type: 'named',
      createdAt: new Date().toISOString(),
      sessionType: 'v2',
    });

    res.json({ thread });
  } catch (error) {
    console.error('Error creating thread:', error);
    res.status(500).json({ error: 'Failed to create thread' });
  }
});

// Get thread messages (paginated)
router.get('/threads/:id/messages', (req, res) => {
  try {
    const { id } = req.params;
    const { before, limit } = req.query;

    const thread = getThread(id);
    if (!thread) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }

    const messages = getMessages({
      threadId: id,
      before: before as string | undefined,
      limit: limit ? parseInt(limit as string, 10) : 50,
    });

    res.json({ messages });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Mark messages as read
router.post('/messages/read', (req, res) => {
  try {
    const { threadId, beforeId } = req.body;

    if (!threadId || !beforeId) {
      res.status(400).json({ error: 'threadId and beforeId required' });
      return;
    }

    const message = getMessage(beforeId);
    if (!message || message.thread_id !== threadId) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }

    markMessagesRead(threadId, beforeId, new Date().toISOString());

    res.json({ success: true });
  } catch (error) {
    console.error('Error marking messages as read:', error);
    res.status(500).json({ error: 'Failed to mark messages as read' });
  }
});

// Archive a thread
router.post('/threads/:id/archive', (req, res) => {
  try {
    const { id } = req.params;
    const thread = getThread(id);
    if (!thread) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }

    archiveThread(id, new Date().toISOString());
    res.json({ success: true });
  } catch (error) {
    console.error('Error archiving thread:', error);
    res.status(500).json({ error: 'Failed to archive thread' });
  }
});

// Pin a thread
router.post('/threads/:id/pin', (req, res) => {
  try {
    const { id } = req.params;
    const thread = getThread(id);
    if (!thread) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }

    pinThread(id);
    const updated = getThread(id)!;

    registry.broadcast({
      type: 'thread_updated',
      thread: {
        id: updated.id,
        name: updated.name,
        type: updated.type,
        unread_count: updated.unread_count,
        last_activity_at: updated.last_activity_at,
        last_message_preview: null,
        pinned_at: updated.pinned_at,
      },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error pinning thread:', error);
    res.status(500).json({ error: 'Failed to pin thread' });
  }
});

// Unpin a thread
router.post('/threads/:id/unpin', (req, res) => {
  try {
    const { id } = req.params;
    const thread = getThread(id);
    if (!thread) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }

    unpinThread(id);

    registry.broadcast({
      type: 'thread_updated',
      thread: {
        id: thread.id,
        name: thread.name,
        type: thread.type,
        unread_count: thread.unread_count,
        last_activity_at: thread.last_activity_at,
        last_message_preview: null,
        pinned_at: null,
      },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error unpinning thread:', error);
    res.status(500).json({ error: 'Failed to unpin thread' });
  }
});

// Delete a thread and all associated data
router.delete('/threads/:id', (req, res) => {
  try {
    const { id } = req.params;
    const thread = getThread(id);
    if (!thread) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }

    const fileIds = deleteThread(id);

    // Clean up files on disk
    for (const fileId of fileIds) {
      deleteFile(fileId);
    }

    // Broadcast deletion to all connected clients
    registry.broadcast({ type: 'thread_deleted', threadId: id });

    res.json({ success: true, deletedFiles: fileIds.length });
  } catch (error) {
    console.error('Error deleting thread:', error);
    res.status(500).json({ error: 'Failed to delete thread' });
  }
});

// --- File upload/download ---

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

const uploadRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Too many uploads, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
});

// File upload
router.post('/files', uploadRateLimiter, upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file provided' });
      return;
    }

    const fileMeta = saveFile(req.file.buffer, req.file.originalname, req.file.mimetype);
    res.json(fileMeta);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Upload failed';
    console.error('File upload error:', msg);
    res.status(400).json({ error: msg });
  }
});

// File listing (MUST be before /files/:id)
router.get('/files/list', (req, res) => {
  try {
    const files = listFiles();

    // Scan messages for fileId references to determine in-use status
    const db = getDb();
    const rows = db.prepare('SELECT metadata FROM messages WHERE metadata IS NOT NULL AND deleted_at IS NULL').all() as Array<{ metadata: string }>;
    const usedFileIds = new Set<string>();
    for (const row of rows) {
      try {
        const meta = JSON.parse(row.metadata);
        if (meta.fileId) usedFileIds.add(meta.fileId);
      } catch { /* skip */ }
    }

    const enriched = files.map(f => ({
      ...f,
      inUse: usedFileIds.has(f.fileId),
    }));

    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    const orphanCount = enriched.filter(f => !f.inUse).length;

    res.json({ files: enriched, totalSize, totalCount: files.length, orphanCount });
  } catch (error) {
    console.error('Error listing files:', error);
    res.status(500).json({ error: 'Failed to list files' });
  }
});

// Delete a file
router.delete('/files/:id', (req, res) => {
  try {
    const deleted = deleteFile(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting file:', error);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

// File download
router.get('/files/:id', (req, res) => {
  try {
    const file = getFile(req.params.id);
    if (!file) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=86400'); // 24h cache
    res.sendFile(file.path);
  } catch (error) {
    console.error('File download error:', error);
    res.status(500).json({ error: 'Failed to retrieve file' });
  }
});

// Rename a thread
router.patch('/threads/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'Thread name required' });
      return;
    }

    const thread = getThread(id);
    if (!thread) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }

    const db = getDb();
    db.prepare('UPDATE threads SET name = ? WHERE id = ?').run(name, id);

    // Broadcast updated thread to all clients
    registry.broadcast({
      type: 'thread_updated',
      thread: {
        id: thread.id,
        name,
        type: thread.type,
        unread_count: thread.unread_count,
        last_activity_at: thread.last_activity_at,
        last_message_preview: null,
        pinned_at: thread.pinned_at ?? null,
      },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error renaming thread:', error);
    res.status(500).json({ error: 'Failed to rename thread' });
  }
});

// Message search
router.get('/search', (req, res) => {
  try {
    const q = req.query.q as string;
    if (!q || q.trim().length === 0) {
      return res.status(400).json({ error: 'Search query required' });
    }
    const threadId = req.query.threadId as string | undefined;
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const offset = parseInt(req.query.offset as string, 10) || 0;

    const { messages: rows, total } = searchMessages({ query: q.trim(), threadId, limit, offset });

    const results = rows.map(row => {
      // Build highlight snippet around match
      const idx = row.content.toLowerCase().indexOf(q.toLowerCase());
      const start = Math.max(0, idx - 40);
      const end = Math.min(row.content.length, idx + q.length + 40);
      const highlight = (start > 0 ? '...' : '') + row.content.slice(start, end) + (end < row.content.length ? '...' : '');

      return {
        messageId: row.id,
        threadId: row.thread_id,
        threadName: row.thread_name,
        role: row.role,
        content: row.content.substring(0, 200),
        highlight,
        createdAt: row.created_at,
      };
    });

    res.json({ results, total });
  } catch (error) {
    console.error('Error searching messages:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Audit log entries
router.get('/audit', (req, res) => {
  try {
    const { limit } = req.query;
    const entries = getRecentAuditEntries(limit ? parseInt(limit as string, 10) : 50);
    res.json({ entries });
  } catch (error) {
    console.error('Error fetching audit log:', error);
    res.status(500).json({ error: 'Failed to fetch audit log' });
  }
});

// Agent sessions (via SDK listSessions)
router.get('/sessions', async (req, res) => {
  try {
    const { limit } = req.query;
    const agentService = req.app.locals.agentService as AgentService;
    const sessions = await agentService.listSessions(limit ? parseInt(limit as string, 10) : 50);
    res.json({ sessions });
  } catch (error) {
    console.error('Error fetching sessions:', error);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

// --- Settings & Orchestrator endpoints ---

// Get all config
router.get('/settings', (req, res) => {
  try {
    const config = getAllConfig();
    res.json({ config });
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// Update a config value
router.put('/settings', (req, res) => {
  try {
    const { key, value } = req.body;
    if (!key || typeof key !== 'string' || typeof value !== 'string') {
      res.status(400).json({ error: 'key and value (strings) required' });
      return;
    }
    setConfig(key, value);
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating setting:', error);
    res.status(500).json({ error: 'Failed to update setting' });
  }
});

// Get config endpoint — returns companion/user names plus all DB config
router.get('/config', (req, res) => {
  try {
    const resonantConfig = getResonantConfig();
    const dbConfig = getAllConfig();
    res.json({
      companion_name: resonantConfig.identity.companion_name,
      user_name: resonantConfig.identity.user_name,
      timezone: resonantConfig.identity.timezone,
      config: dbConfig,
    });
  } catch (error) {
    console.error('Error fetching config:', error);
    res.status(500).json({ error: 'Failed to fetch config' });
  }
});

// Get skills from agent CWD
router.get('/skills', (req, res) => {
  try {
    const config = getResonantConfig();
    const agentCwd = config.agent.cwd;
    const skillsDir = join(agentCwd, '.claude', 'skills');

    if (!existsSync(skillsDir)) {
      res.json({ skills: [] });
      return;
    }

    const skills: Array<{ name: string; description: string }> = [];
    const dirs = readdirSync(skillsDir, { withFileTypes: true });

    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      const skillFile = join(skillsDir, dir.name, 'SKILL.md');
      if (!existsSync(skillFile)) continue;

      const content = readFileSync(skillFile, 'utf-8');

      // Parse YAML frontmatter
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!fmMatch) continue;

      const fm = fmMatch[1];
      const nameMatch = fm.match(/^name:\s*["']?(.+?)["']?\s*$/m);
      const descMatch = fm.match(/^description:\s*["']?(.+?)["']?\s*$/m);

      skills.push({
        name: nameMatch?.[1] || dir.name,
        description: descMatch?.[1] || '',
      });
    }

    res.json({ skills });
  } catch (error) {
    console.error('Error reading skills:', error);
    res.status(500).json({ error: 'Failed to read skills' });
  }
});

// --- Canvas REST routes ---

// List canvases
router.get('/canvases', (req, res) => {
  try {
    const canvases = listCanvases();
    res.json({ canvases });
  } catch (error) {
    console.error('Error listing canvases:', error);
    res.status(500).json({ error: 'Failed to list canvases' });
  }
});

// Create canvas
router.post('/canvases', (req, res) => {
  try {
    const { title, contentType, language, threadId } = req.body;
    if (!title || typeof title !== 'string') {
      res.status(400).json({ error: 'title is required' });
      return;
    }

    const now = new Date().toISOString();
    const canvas = createCanvas({
      id: crypto.randomUUID(),
      threadId: threadId || undefined,
      title,
      contentType: contentType || 'markdown',
      language: language || undefined,
      createdBy: 'user',
      createdAt: now,
    });

    registry.broadcast({ type: 'canvas_created', canvas });
    res.json({ canvas });
  } catch (error) {
    console.error('Error creating canvas:', error);
    res.status(500).json({ error: 'Failed to create canvas' });
  }
});

// Get canvas
router.get('/canvases/:id', (req, res) => {
  try {
    const canvas = getCanvas(req.params.id);
    if (!canvas) {
      res.status(404).json({ error: 'Canvas not found' });
      return;
    }
    res.json({ canvas });
  } catch (error) {
    console.error('Error fetching canvas:', error);
    res.status(500).json({ error: 'Failed to fetch canvas' });
  }
});

// Update canvas
router.patch('/canvases/:id', (req, res) => {
  try {
    const canvas = getCanvas(req.params.id);
    if (!canvas) {
      res.status(404).json({ error: 'Canvas not found' });
      return;
    }

    const now = new Date().toISOString();
    const { title, content } = req.body;

    if (title !== undefined) {
      updateCanvasTitle(req.params.id, title, now);
    }
    if (content !== undefined) {
      updateCanvasContent(req.params.id, content, now);
      registry.broadcast({ type: 'canvas_updated', canvasId: req.params.id, content, updatedAt: now });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating canvas:', error);
    res.status(500).json({ error: 'Failed to update canvas' });
  }
});

// Delete canvas
router.delete('/canvases/:id', (req, res) => {
  try {
    const deleted = deleteCanvas(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Canvas not found' });
      return;
    }
    registry.broadcast({ type: 'canvas_deleted', canvasId: req.params.id });
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting canvas:', error);
    res.status(500).json({ error: 'Failed to delete canvas' });
  }
});

// --- Push subscription endpoints ---

// Subscribe to push notifications
router.post('/push/subscribe', (req, res) => {
  try {
    const { endpoint, keys, deviceLabel } = req.body;
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      res.status(400).json({ error: 'endpoint and keys (p256dh, auth) required' });
      return;
    }

    const id = crypto.randomUUID();
    addPushSubscription({
      id,
      endpoint,
      keysP256dh: keys.p256dh,
      keysAuth: keys.auth,
      deviceName: deviceLabel,
    });

    res.json({ success: true, id });
  } catch (error) {
    console.error('Error subscribing to push:', error);
    res.status(500).json({ error: 'Failed to subscribe' });
  }
});

// Unsubscribe from push notifications
router.post('/push/unsubscribe', (req, res) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) {
      res.status(400).json({ error: 'endpoint required' });
      return;
    }

    const removed = removePushSubscription(endpoint);
    res.json({ success: true, removed });
  } catch (error) {
    console.error('Error unsubscribing from push:', error);
    res.status(500).json({ error: 'Failed to unsubscribe' });
  }
});

// List push subscriptions (truncated endpoints for display)
router.get('/push/subscriptions', (req, res) => {
  try {
    const subs = listPushSubscriptions();
    const display = subs.map(s => ({
      id: s.id,
      deviceName: s.device_name,
      endpoint: s.endpoint ? s.endpoint.slice(0, 60) + '...' : null,
      createdAt: s.created_at,
      lastUsedAt: s.last_used_at,
    }));
    res.json({ subscriptions: display });
  } catch (error) {
    console.error('Error listing push subscriptions:', error);
    res.status(500).json({ error: 'Failed to list subscriptions' });
  }
});

// Send test push notification
router.post('/push/test', async (req, res) => {
  try {
    const pushService = req.app.locals.pushService as PushService | undefined;
    if (!pushService?.isConfigured()) {
      res.status(503).json({ error: 'Push notifications not configured — set VAPID keys in .env' });
      return;
    }

    const config = getResonantConfig();
    await pushService.sendPush({
      title: config.identity.companion_name,
      body: 'Push notifications are working!',
      tag: 'test',
      url: '/chat',
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error sending test push:', error);
    res.status(500).json({ error: 'Failed to send test push' });
  }
});

// Get orchestrator task status
router.get('/orchestrator/status', async (req, res) => {
  try {
    const orchestrator = req.app.locals.orchestrator as Orchestrator | undefined;
    if (!orchestrator) {
      res.status(503).json({ error: 'Orchestrator not available' });
      return;
    }
    const tasks = await orchestrator.getStatus();
    res.json({ tasks });
  } catch (error) {
    console.error('Error fetching orchestrator status:', error);
    res.status(500).json({ error: 'Failed to fetch orchestrator status' });
  }
});

// Enable/disable/reschedule a task
router.patch('/orchestrator/tasks/:wakeType', async (req, res) => {
  try {
    const orchestrator = req.app.locals.orchestrator as Orchestrator | undefined;
    if (!orchestrator) {
      res.status(503).json({ error: 'Orchestrator not available' });
      return;
    }

    const { wakeType } = req.params;
    const { enabled, cronExpr } = req.body;

    if (cronExpr !== undefined) {
      if (typeof cronExpr !== 'string') {
        res.status(400).json({ error: 'cronExpr must be a string' });
        return;
      }
      const success = orchestrator.rescheduleTask(wakeType, cronExpr);
      if (!success) {
        res.status(400).json({ error: 'Failed to reschedule — invalid cron expression or unknown task' });
        return;
      }
    }

    if (enabled !== undefined) {
      if (typeof enabled !== 'boolean') {
        res.status(400).json({ error: 'enabled must be a boolean' });
        return;
      }
      const success = enabled
        ? orchestrator.enableTask(wakeType)
        : orchestrator.disableTask(wakeType);
      if (!success) {
        res.status(404).json({ error: 'Unknown task' });
        return;
      }
    }

    const tasks = await orchestrator.getStatus();
    res.json({ success: true, tasks });
  } catch (error) {
    console.error('Error updating orchestrator task:', error);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

// Get failsafe config
router.get('/orchestrator/failsafe', (req, res) => {
  try {
    const orchestrator = req.app.locals.orchestrator as Orchestrator | undefined;
    if (!orchestrator) {
      res.status(503).json({ error: 'Orchestrator not available' });
      return;
    }
    res.json(orchestrator.getFailsafeConfig());
  } catch (error) {
    console.error('Error fetching failsafe config:', error);
    res.status(500).json({ error: 'Failed to fetch failsafe config' });
  }
});

// Update failsafe config
router.patch('/orchestrator/failsafe', (req, res) => {
  try {
    const orchestrator = req.app.locals.orchestrator as Orchestrator | undefined;
    if (!orchestrator) {
      res.status(503).json({ error: 'Orchestrator not available' });
      return;
    }

    const { enabled, gentle, concerned, emergency } = req.body;
    orchestrator.setFailsafeConfig({ enabled, gentle, concerned, emergency });
    res.json({ success: true, ...orchestrator.getFailsafeConfig() });
  } catch (error) {
    console.error('Error updating failsafe config:', error);
    res.status(500).json({ error: 'Failed to update failsafe config' });
  }
});

// Get active triggers
router.get('/orchestrator/triggers', (req, res) => {
  try {
    const kind = req.query.kind as 'impulse' | 'watcher' | undefined;
    const triggers = listTriggers(kind);
    res.json({ triggers });
  } catch (error) {
    console.error('Error fetching triggers:', error);
    res.status(500).json({ error: 'Failed to fetch triggers' });
  }
});

// Cancel a trigger
router.delete('/orchestrator/triggers/:id', (req, res) => {
  try {
    const cancelled = cancelTrigger(req.params.id);
    if (!cancelled) {
      res.status(404).json({ error: 'Trigger not found or already cancelled' });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Error cancelling trigger:', error);
    res.status(500).json({ error: 'Failed to cancel trigger' });
  }
});

// --- Discord admin endpoints ---

import { DiscordService } from '../services/discord/index.js';
import type { AgentService } from '../services/agent.js';

router.get('/discord/status', (req, res) => {
  try {
    const discordService = req.app.locals.discordService as DiscordService | null;
    const configEnabled = getConfigBool('discord.enabled', false);
    const hasToken = !!process.env.DISCORD_BOT_TOKEN;
    if (!discordService) {
      res.json({ enabled: false, configEnabled, hasToken });
      return;
    }
    res.json({ enabled: true, configEnabled, hasToken, ...discordService.getStats() });
  } catch (error) {
    console.error('Error fetching Discord status:', error);
    res.status(500).json({ error: 'Failed to fetch Discord status' });
  }
});

router.post('/discord/toggle', async (req, res) => {
  try {
    const { enabled } = req.body as { enabled: boolean };
    const agentService = req.app.locals.agentService as AgentService;

    if (enabled) {
      // Start Discord gateway
      if (!process.env.DISCORD_BOT_TOKEN) {
        res.status(400).json({ error: 'DISCORD_BOT_TOKEN not set in .env' });
        return;
      }
      if (req.app.locals.discordService) {
        res.json({ success: true, message: 'Already running' });
        return;
      }
      const service = new DiscordService(agentService, registry);
      await service.start();
      req.app.locals.discordService = service;
      setConfig('discord.enabled', 'true');
      console.log('[Discord] Gateway enabled via settings toggle');
      res.json({ success: true, message: 'Discord gateway started' });
    } else {
      // Stop Discord gateway
      const service = req.app.locals.discordService as DiscordService | null;
      if (service) {
        await service.stop();
        req.app.locals.discordService = null;
      }
      setConfig('discord.enabled', 'false');
      console.log('[Discord] Gateway disabled via settings toggle');
      res.json({ success: true, message: 'Discord gateway stopped' });
    }
  } catch (error) {
    console.error('Error toggling Discord:', error);
    res.status(500).json({ error: 'Failed to toggle Discord gateway' });
  }
});

router.get('/discord/pairings', (req, res) => {
  try {
    const discordService = req.app.locals.discordService as DiscordService | null;
    if (!discordService) {
      res.json({ pending: [], approved: [] });
      return;
    }
    const pairing = discordService.getPairingService();
    res.json({
      pending: pairing.listPending(),
      approved: pairing.listApproved(),
    });
  } catch (error) {
    console.error('Error fetching pairings:', error);
    res.status(500).json({ error: 'Failed to fetch pairings' });
  }
});

router.post('/discord/pairings/:code/approve', (req, res) => {
  try {
    const discordService = req.app.locals.discordService as DiscordService | null;
    if (!discordService) {
      res.status(503).json({ error: 'Discord not enabled' });
      return;
    }
    const pairing = discordService.getPairingService();
    const result = pairing.approve(req.params.code, 'user');
    if (result.success) {
      res.json({ success: true, userId: result.userId });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error) {
    console.error('Error approving pairing:', error);
    res.status(500).json({ error: 'Failed to approve pairing' });
  }
});

router.delete('/discord/pairings/:userId', (req, res) => {
  try {
    const discordService = req.app.locals.discordService as DiscordService | null;
    if (!discordService) {
      res.status(503).json({ error: 'Discord not enabled' });
      return;
    }
    const pairing = discordService.getPairingService();
    const revoked = pairing.revoke(req.params.userId);
    res.json({ success: revoked });
  } catch (error) {
    console.error('Error revoking pairing:', error);
    res.status(500).json({ error: 'Failed to revoke pairing' });
  }
});

// --- Discord settings & rules admin ---

import { getDiscordConfig, getAllowedUsers, getAllowedGuilds, getActiveChannels } from '../services/discord/config.js';
import { getRulesData, saveRules, reloadRules } from '../services/discord/rules.js';
import type { ServerRule, ChannelRule, UserRule, RulesData } from '../services/discord/rules.js';

// GET /discord/settings — all config values
router.get('/discord/settings', (req, res) => {
  try {
    const config = getDiscordConfig();
    res.json({
      ...config,
      allowedUsers: [...getAllowedUsers()],
      allowedGuilds: [...getAllowedGuilds()],
      activeChannels: [...getActiveChannels()],
    });
  } catch (error) {
    console.error('Error fetching Discord settings:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// PUT /discord/settings — partial update of config values
router.put('/discord/settings', (req, res) => {
  try {
    const body = req.body as Record<string, unknown>;

    // Map of setting keys to their DB config keys
    const settingsMap: Record<string, string> = {
      ownerUserId: 'discord.ownerUserId',
      requireMentionInGuilds: 'discord.requireMentionInGuilds',
      debounceMs: 'discord.debounceMs',
      pairingExpiryMs: 'discord.pairingExpiryMs',
      ownerActiveThresholdMin: 'discord.ownerActiveThresholdMin',
      deferPollIntervalMs: 'discord.deferPollIntervalMs',
      deferMaxAgeMs: 'discord.deferMaxAgeMs',
    };

    // Set-based settings (stored as comma-separated)
    const setSettingsMap: Record<string, string> = {
      allowedUsers: 'discord.allowedUsers',
      allowedGuilds: 'discord.allowedGuilds',
      activeChannels: 'discord.activeChannels',
    };

    let updated = 0;

    for (const [key, dbKey] of Object.entries(settingsMap)) {
      if (key in body) {
        setConfig(dbKey, String(body[key]));
        updated++;
      }
    }

    for (const [key, dbKey] of Object.entries(setSettingsMap)) {
      if (key in body) {
        const val = body[key];
        const str = Array.isArray(val) ? val.join(',') : String(val);
        setConfig(dbKey, str);
        updated++;
      }
    }

    // Return current state after update
    const config = getDiscordConfig();
    res.json({
      success: true,
      updated,
      ...config,
      allowedUsers: [...getAllowedUsers()],
      allowedGuilds: [...getAllowedGuilds()],
      activeChannels: [...getActiveChannels()],
    });
  } catch (error) {
    console.error('Error updating Discord settings:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// GET /discord/rules — full rules blob
router.get('/discord/rules', (req, res) => {
  try {
    res.json(getRulesData());
  } catch (error) {
    console.error('Error fetching Discord rules:', error);
    res.status(500).json({ error: 'Failed to fetch rules' });
  }
});

// PUT /discord/rules — full rules blob replace + reload
router.put('/discord/rules', (req, res) => {
  try {
    const data = req.body as RulesData;
    if (!data.servers || !data.channels || !data.users) {
      res.status(400).json({ error: 'Rules must have servers, channels, and users' });
      return;
    }
    saveRules(data);
    res.json({ success: true, ...getRulesData() });
  } catch (error) {
    console.error('Error saving Discord rules:', error);
    res.status(500).json({ error: 'Failed to save rules' });
  }
});

// POST /discord/rules/server — add/update one server rule
router.post('/discord/rules/server', (req, res) => {
  try {
    const rule = req.body as ServerRule;
    if (!rule.id || !rule.name) {
      res.status(400).json({ error: 'Server rule requires id and name' });
      return;
    }
    const data = getRulesData();
    data.servers[rule.id] = rule;
    saveRules(data);
    res.json({ success: true, rule });
  } catch (error) {
    console.error('Error saving server rule:', error);
    res.status(500).json({ error: 'Failed to save server rule' });
  }
});

// DELETE /discord/rules/server/:id
router.delete('/discord/rules/server/:id', (req, res) => {
  try {
    const data = getRulesData();
    if (!(req.params.id in data.servers)) {
      res.status(404).json({ error: 'Server rule not found' });
      return;
    }
    delete data.servers[req.params.id];
    saveRules(data);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting server rule:', error);
    res.status(500).json({ error: 'Failed to delete server rule' });
  }
});

// POST /discord/rules/channel — add/update one channel rule
router.post('/discord/rules/channel', (req, res) => {
  try {
    const rule = req.body as ChannelRule;
    if (!rule.id || !rule.name) {
      res.status(400).json({ error: 'Channel rule requires id and name' });
      return;
    }
    const data = getRulesData();
    data.channels[rule.id] = rule;
    saveRules(data);
    res.json({ success: true, rule });
  } catch (error) {
    console.error('Error saving channel rule:', error);
    res.status(500).json({ error: 'Failed to save channel rule' });
  }
});

// DELETE /discord/rules/channel/:id
router.delete('/discord/rules/channel/:id', (req, res) => {
  try {
    const data = getRulesData();
    if (!(req.params.id in data.channels)) {
      res.status(404).json({ error: 'Channel rule not found' });
      return;
    }
    delete data.channels[req.params.id];
    saveRules(data);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting channel rule:', error);
    res.status(500).json({ error: 'Failed to delete channel rule' });
  }
});

// POST /discord/rules/user — add/update one user rule
router.post('/discord/rules/user', (req, res) => {
  try {
    const rule = req.body as UserRule;
    if (!rule.id || !rule.name) {
      res.status(400).json({ error: 'User rule requires id and name' });
      return;
    }
    const data = getRulesData();
    data.users[rule.id] = rule;
    saveRules(data);
    res.json({ success: true, rule });
  } catch (error) {
    console.error('Error saving user rule:', error);
    res.status(500).json({ error: 'Failed to save user rule' });
  }
});

// DELETE /discord/rules/user/:id
router.delete('/discord/rules/user/:id', (req, res) => {
  try {
    const data = getRulesData();
    if (!(req.params.id in data.users)) {
      res.status(404).json({ error: 'User rule not found' });
      return;
    }
    delete data.users[req.params.id];
    saveRules(data);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting user rule:', error);
    res.status(500).json({ error: 'Failed to delete user rule' });
  }
});

/** Call after loadConfig() to mount Command Center routes */
export async function initCcRoutes() {
  try {
    if (getResonantConfig().command_center.enabled) {
      const { default: ccRoutes } = await import('./cc-routes.js');
      router.use('/cc', ccRoutes);
    }
  } catch (e) {
    console.warn('[CC] Failed to mount Command Center routes:', (e as Error).message);
  }
}

export default router;
