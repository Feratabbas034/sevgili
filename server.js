import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT) || 3001;
const adminKey = process.env.ADMIN_KEY || 'change-this-admin-key';
const dataDir = path.join(__dirname, 'data');
const dataFile = path.join(dataDir, 'heartquest-log.json');
const distDir = path.join(__dirname, 'dist');
let mutationQueue = Promise.resolve();

app.use(express.json());

async function ensureStore() {
  await fs.mkdir(dataDir, { recursive: true });

  try {
    await fs.access(dataFile);
  } catch {
    await fs.writeFile(dataFile, JSON.stringify({ sessions: [] }, null, 2));
  }
}

async function readStore() {
  await ensureStore();
  const raw = await fs.readFile(dataFile, 'utf8');
  const parsed = JSON.parse(raw);
  return {
    sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
  };
}

async function writeStore(store) {
  await fs.writeFile(dataFile, JSON.stringify(store, null, 2));
}

function getRequestIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }

  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.length > 0) {
    return realIp;
  }

  return req.socket.remoteAddress || 'unknown';
}

function sortSessions(store) {
  return {
    sessions: [...store.sessions].sort((a, b) => b.startedAt - a.startedAt),
  };
}

function withMutationLock(task) {
  const nextTask = mutationQueue.then(task, task);
  mutationQueue = nextTask.catch(() => {});
  return nextTask;
}

function requireAdmin(req, res, next) {
  if (req.headers['x-admin-key'] !== adminKey) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}

app.get('/api/session/:id', async (req, res) => {
  const store = await readStore();
  const session = store.sessions.find((item) => item.id === req.params.id);

  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  res.json({ session });
});

app.get('/api/admin/state', requireAdmin, async (_req, res) => {
  const store = await readStore();
  res.json(sortSessions(store));
});

app.post('/api/session', async (req, res) => {
  const payload = await withMutationLock(async () => {
    const store = await readStore();
    const now = Date.now();
    const ip = getRequestIp(req);
    const session = {
      id: `session-${now}-${Math.random().toString(16).slice(2, 8)}`,
      ip,
      fingerprint: req.body?.fingerprint || 'unknown-fingerprint',
      userAgent: req.body?.userAgent || 'unknown-agent',
      startedAt: now,
      updatedAt: now,
      status: 'waiting',
      responses: {},
      logs: [
        {
          id: `log-${now}`,
          type: 'session_started',
          label: 'Yeni ziyaret basladi',
          detail: 'Sunucu yeni bir oturum acti',
          at: now,
          ip,
        },
      ],
    };

    store.sessions.push(session);
    await writeStore(store);

    return {
      session,
      state: sortSessions(store),
    };
  });

  res.status(201).json(payload);
});

app.post('/api/event', async (req, res) => {
  const payload = await withMutationLock(async () => {
    const store = await readStore();
    const session = store.sessions.find((item) => item.id === req.body?.sessionId);

    if (!session) {
      return null;
    }

    const now = Date.now();
    const ip = getRequestIp(req);
    const log = {
      id: `log-${now}-${Math.random().toString(16).slice(2, 8)}`,
      type: req.body?.type || 'interaction',
      label: req.body?.label || 'Etkilesim',
      detail: req.body?.detail || 'Detay verilmedi',
      at: now,
      ip,
    };

    session.ip = ip;
    session.updatedAt = now;
    session.status = req.body?.status || session.status;
    session.responses = {
      ...session.responses,
      ...(req.body?.responsePatch || {}),
    };
    session.logs = [log, ...(session.logs || [])];

    await writeStore(store);

    return {
      session,
      state: sortSessions(store),
    };
  });

  if (!payload) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  res.json(payload);
});

app.use(express.static(distDir));

app.get('/{*any}', async (_req, res) => {
  try {
    await fs.access(path.join(distDir, 'index.html'));
    res.sendFile(path.join(distDir, 'index.html'));
  } catch {
    res.status(404).send('Build output not found. Run "npm run build" first.');
  }
});

app.listen(port, () => {
  console.log(`HeartQuest server listening on http://localhost:${port}`);
});
