import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { FundingBot, botDefaults } from './src/bot.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const bot = new FundingBot();
const port = Number(process.env.PORT || 3000);
const authToken = process.env.BOT_AUTH_TOKEN || '';

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

function auth(req, res, next) {
  if (!authToken) return res.status(503).json({ ok: false, error: 'BOT_AUTH_TOKEN is not configured.' });
  const supplied = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.headers['x-bot-token'];
  if (!supplied || supplied !== authToken) return res.status(401).json({ ok: false, error: 'Unauthorized.' });
  next();
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, time: Date.now(), liveTrading: process.env.ENABLE_LIVE_TRADING === 'true' && process.env.ALLOW_LIVE_ORDERS === 'true' });
});

app.get('/api/config', (_req, res) => {
  res.json({
    ok: true,
    liveTrading: process.env.ENABLE_LIVE_TRADING === 'true' && process.env.ALLOW_LIVE_ORDERS === 'true',
    authConfigured: Boolean(authToken),
    defaults: botDefaults
  });
});

app.get('/api/public/market', (_req, res) => {
  res.json({ ok: true, ...bot.snapshot() });
});

app.get('/api/private/status', auth, async (_req, res) => {
  try {
    res.json({ ok: true, ...(await bot.status()) });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/bot/start', auth, (_req, res) => {
  bot.setRunning(true);
  res.json({ ok: true, ...bot.snapshot() });
});

app.post('/api/bot/stop', auth, (_req, res) => {
  bot.setRunning(false);
  res.json({ ok: true, ...bot.snapshot() });
});

app.post('/api/bot/auto', auth, (req, res) => {
  bot.setAuto(Boolean(req.body?.enabled));
  res.json({ ok: true, ...bot.snapshot() });
});

app.post('/api/bot/prepare', auth, async (req, res) => {
  try {
    const { symbol, leverage } = req.body || {};
    if (!symbol) return res.status(400).json({ ok: false, error: 'symbol is required.' });
    const result = await bot.prepare(symbol, Number(leverage || botDefaults.leverage));
    res.json({ ok: true, ...result, ...bot.snapshot() });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post('/api/bot/settings', auth, (req, res) => {
  try {
    const settings = bot.setSettings(req.body || {});
    res.json({ ok: true, settings, ...bot.snapshot() });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post('/api/bot/open', auth, async (req, res) => {
  try {
    const { symbol, marginUsdt, leverage, side } = req.body || {};
    if (!symbol) return res.status(400).json({ ok: false, error: 'symbol is required.' });
    const result = await bot.open(symbol, {
      reason: 'MANUAL',
      marginUsdt: Number(marginUsdt || botDefaults.marginUsdt),
      leverage: Number(leverage || botDefaults.leverage),
      sideOverride: side === 'LONG' || side === 'SHORT' ? side : null
    });
    res.json({ ok: true, result, ...bot.snapshot() });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post('/api/bot/close', auth, async (req, res) => {
  try {
    const result = await bot.close({ reason: String(req.body?.reason || 'MANUAL') });
    res.json({ ok: true, result, ...bot.snapshot() });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.use((req, res, next) => {
  if (req.path.startsWith('/api/') || req.path === '/ws') return next();
  if (req.method !== 'GET') return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  bot.attachClient({
    send(message) {
      if (ws.readyState === ws.OPEN) ws.send(message);
    }
  });
  ws.on('close', () => {});
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

httpServer.listen(port, async () => {
  console.log(`Toobit Funding Bot listening on :${port}`);
  try {
    await bot.boot();
    console.log(`Scanner online. Contracts: ${bot.contracts.size}`);
    if (process.env.ENABLE_LIVE_TRADING !== 'true' || process.env.ALLOW_LIVE_ORDERS !== 'true') {
      console.log('LIVE TRADING OFF â€” paper mode is active.');
    }
  } catch (error) {
    console.error('Bot boot error:', error);
    bot.lastError = error.message;
  }
});
