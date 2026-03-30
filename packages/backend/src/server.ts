import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { createServer } from 'http';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';
import { loadConfig } from './config.js';
import { initDb, deleteExpiredSessions } from './services/db.js';
import { loadVectorCache } from './services/vector-cache.js';
import { createWebSocketServer, setVoiceService, setGatewayServices, registry } from './services/ws.js';
import { Orchestrator } from './services/orchestrator.js';
import { AgentService } from './services/agent.js';
import { VoiceService } from './services/voice.js';
import { PushService } from './services/push.js';
import { DiscordService } from './services/discord/index.js';
import { TelegramService } from './services/telegram/index.js';
import { rateLimiter, securityHeaders } from './middleware/security.js';
import apiRoutes, { initCcRoutes } from './routes/api.js';

// Load config FIRST — before any other initialization
const config = loadConfig();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = config.server.port;
const HOST = config.server.host;
const DB_PATH = config.server.db_path;

// Ensure data directory exists
const dataDir = dirname(DB_PATH);
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

// Ensure files directory exists
const filesDir = join(dataDir, 'files');
if (!existsSync(filesDir)) {
  mkdirSync(filesDir, { recursive: true });
}

// Initialize database
console.log('Initializing database...');
const db = initDb(DB_PATH);
deleteExpiredSessions();
loadVectorCache();
console.log('Database initialized');

// Create Express app
const app = express();

// Trust proxy headers (e.g. Cloudflare tunnel, nginx)
app.set('trust proxy', 1);

// Environment-conditional origins
const IS_DEV = process.env.NODE_ENV !== 'production';
const corsOrigins: string[] = [...config.cors.origins, `http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`];
if (IS_DEV) corsOrigins.push('http://localhost:5173');

const connectSrc: string[] = ["'self'"];
// Derive WebSocket connect sources from CORS origins
for (const origin of config.cors.origins) {
  const wsOrigin = origin.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
  connectSrc.push(wsOrigin);
}
if (IS_DEV) connectSrc.push(`ws://localhost:${PORT}`);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc,
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      mediaSrc: ["'self'", "blob:"],
      fontSrc: ["'self'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      workerSrc: ["'self'"],
    }
  },
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'same-origin' },
}));

app.use(securityHeaders);
// Rate limiter only on API/MCP routes — not static assets
app.use('/api', rateLimiter);
app.use('/mcp', rateLimiter);

// CORS
app.use(cors({
  origin: corsOrigins,
  credentials: true,
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// All API routes — auth middleware is applied selectively inside the router
app.use('/api', apiRoutes);

// Command Center MCP endpoint
if (config.command_center.enabled) {
  import('./routes/cc-mcp.js').then(m => app.use('/mcp/cc', m.default));
}

// Serve frontend static build (works in dev too if frontend is pre-built)
const frontendPaths = [
  join(__dirname, '../../frontend/build'),         // From compiled dist/
  join(__dirname, '../../../packages/frontend/build'), // From src/ via tsx
];
const frontendBuildPath = frontendPaths.find(p => existsSync(p));
if (frontendBuildPath) {
  console.log(`Serving frontend from: ${frontendBuildPath}`);
  app.use(express.static(frontendBuildPath));
  app.get('*', (req, res) => {
    res.sendFile(join(frontendBuildPath, 'index.html'));
  });
} else {
  console.log('No frontend build found — use Vite dev server on :5173');
}

// Global error handler — must be after all routes
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Create HTTP server
const server = createServer(app);

// Initialize agent service (shared between WebSocket and orchestrator)
const agentService = new AgentService();

// Initialize voice service
const voiceService = new VoiceService();
setVoiceService(voiceService);

// Initialize push service
const pushService = new PushService(
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY,
  process.env.VAPID_CONTACT,
);
agentService.setPushService(pushService);

// Initialize Discord gateway (config-gated with env fallback)
import { getConfigBool } from './services/db.js';

let discordService: DiscordService | null = null;

// Check config DB first, fall back to config file / env var for first boot
const discordEnabled = getConfigBool('discord.enabled', config.discord.enabled);
if (discordEnabled && process.env.DISCORD_BOT_TOKEN) {
  discordService = new DiscordService(agentService, registry);
  discordService.start();
}

// Initialize Telegram gateway (config-gated with env fallback)
let telegramService: TelegramService | null = null;

const telegramEnabled = getConfigBool('telegram.enabled', config.telegram.enabled);
if (telegramEnabled && process.env.TELEGRAM_BOT_TOKEN) {
  telegramService = new TelegramService(agentService, registry, voiceService);
  telegramService.start();
}

// Initialize orchestrator
const orchestrator = new Orchestrator(agentService, pushService);
orchestrator.start();

// Make orchestrator, agent, voice, push, and discord services available to route handlers
app.locals.orchestrator = orchestrator;
app.locals.agentService = agentService;
app.locals.voiceService = voiceService;
app.locals.pushService = pushService;
app.locals.discordService = discordService;
app.locals.telegramService = telegramService;

// Wire gateway services for status reporting
setGatewayServices({ discord: discordService, telegram: telegramService });

// Attach WebSocket server
console.log('Initializing WebSocket server...');
const wss = createWebSocketServer(server, agentService, orchestrator);
console.log('WebSocket server initialized');

// Mount Command Center routes (after config is loaded)
initCcRoutes().then(() => {
  if (config.command_center.enabled) console.log('Command Center routes mounted at /api/cc');
});

// Start server
server.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Auth enabled: ${config.auth.password ? 'yes' : 'no'}`);
  console.log(`Companion: ${config.identity.companion_name} | User: ${config.identity.user_name}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  orchestrator.stop();
  if (discordService) await discordService.stop();
  if (telegramService) await telegramService.stop();
  wss.clients.forEach(ws => ws.close());
  wss.close();
  server.close(() => {
    console.log('Server closed');
    db.close();
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  orchestrator.stop();
  if (discordService) await discordService.stop();
  if (telegramService) await telegramService.stop();
  wss.clients.forEach(ws => ws.close());
  wss.close();
  server.close(() => {
    console.log('Server closed');
    db.close();
    process.exit(0);
  });
});
