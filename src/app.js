import express from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { writeFile, statfs } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { isIP } from 'node:net';
import { fileURLToPath } from 'node:url';
import { LIMITS, UserError, elevenReady } from './config.js';
import { EpisodeStore } from './store.js';

function allowedHost(header, extra) {
  let name;
  try { name = new URL(`http://${header}`).hostname.toLowerCase(); } catch { return false; }
  if (isIP(name.replace(/^\[|\]$/g, ''))) return true;
  return name === 'localhost' || name.endsWith('.ts.net') || name.endsWith('.local') || extra.includes(name);
}

export async function createApp(config) {
  const app = express();
  const store = new EpisodeStore(config.dataDir);
  await store.init();
  let active = null, closing = false, reservations = 0;
  const retrying = new Set();
  const queue = [];
  const pending = () => queue.length + (active ? 1 : 0) + reservations;
  async function diskCheck() {
    const disk = await statfs(config.dataDir);
    if (disk.bavail * disk.bsize < 300 * 1024 * 1024) throw new UserError('Less than 300 MB of disk space is free. Delete old episodes or free space before generating.', 507);
  }
  function processQueue() {
    if (active || !queue.length || closing) return;
    const id = queue.shift();
    const worker = new Worker(new URL('./worker.js', import.meta.url), { workerData: { episode: store.episodes.get(id), directory: store.folder(id), config } });
    active = worker;
    let writes = Promise.resolve();
    let finished = false;
    const update = fields => { writes = writes.then(() => store.save({ ...store.episodes.get(id), ...fields })).catch(() => { worker.terminate(); }); };
    update({ status: 'working', message: 'Starting…' });
    worker.on('message', event => {
      if (event.type === 'progress') update({ message: event.message });
      if (event.type === 'script') update({ script: event.script, sourcePages: event.sourcePages });
      if (event.type === 'complete') { finished = true; update({ status: 'ready', message: 'Ready to listen', audio: event.audio }); }
      if (event.type === 'failed') { finished = true; update({ status: 'failed', message: event.error }); }
    });
    worker.on('error', () => { finished = true; update({ status: 'failed', message: 'The generation worker stopped. Check memory and disk space, then retry.' }); });
    worker.on('exit', async () => {
      if (!finished) update({ status: 'failed', message: 'Generation was interrupted. Retry this episode.' });
      await writes;
      active = null; processQueue();
    });
  }
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" });
    if (req.path.startsWith('/api/')) {
      res.set('Cache-Control', 'no-store');
      if (!req.get('Host') || !allowedHost(req.get('Host'), config.allowedHosts)) return next(new UserError('This host name is not allowed. Add it to ALLOWED_HOSTS.', 403));
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (req.get('X-Docapod') !== '1') return next(new UserError('Missing app request header.', 403));
      if (req.get('Origin')) {
        try { if (new URL(req.get('Origin')).host !== req.get('Host')) throw new Error(); }
        catch { return next(new UserError('Cross-origin requests are not allowed.', 403)); }
      }
    }
    next();
  });
  app.get('/api/settings', (_req, res) => res.json({ scriptProvider: config.scriptProvider, voiceProvider: config.voiceProvider, elevenlabsAvailable: elevenReady(config), model: config.ollamaModel, limits: LIMITS }));
  app.get('/api/episodes', (_req, res) => res.json(store.list().map(({ script, ...episode }) => ({ ...episode, words: script?.words, pages: script?.pages }))));
  app.param('id', (req, _res, next, id) => { if (!store.episodes.has(id)) return next(new UserError('Episode not found.', 404)); req.episode = store.episodes.get(id); next(); });
  app.get('/api/episodes/:id', (req, res) => res.json(req.episode));
  app.get('/api/episodes/:id/audio', (req, res, next) => {
    if (req.episode.status !== 'ready') return next(new UserError('Audio is not ready.', 409));
    if (req.query.download === '1') res.attachment('doc-a-pod.wav');
    res.type('wav').sendFile(path.join(store.folder(req.params.id), 'episode.wav'));
  });
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: LIMITS.uploadBytes, files: 1, fields: 3, fieldSize: 200 } });
  app.post('/api/episodes', (req, _res, next) => pending() >= 3 ? next(new UserError('The queue is full (3 episodes). Wait for an episode to finish.', 429)) : next(), upload.single('paper'), async (req, res) => {
    if (!req.file) throw new UserError('Choose a research paper first.');
    if (!/\.(pdf|txt|md|markdown)$/i.test(req.file.originalname)) throw new UserError('Choose a PDF, .txt, or Markdown file.');
    if (pending() >= 3) throw new UserError('The queue is full. Wait for an episode to finish.', 429);
    const scriptProvider = req.body.scriptProvider || config.scriptProvider;
    const voiceProvider = req.body.voiceProvider || config.voiceProvider;
    if (!['ollama', 'demo'].includes(scriptProvider) || !['kokoro', 'elevenlabs', 'demo'].includes(voiceProvider)) throw new UserError('Unknown provider selection.');
    if (voiceProvider === 'elevenlabs' && !elevenReady(config)) throw new UserError('Configure an ElevenLabs key and two distinct voices first.');
    reservations++;
    try {
      await diskCheck();
      const id = randomUUID();
      const filename = path.basename(req.file.originalname).slice(0, 180);
      const episode = { id, filename, title: filename.replace(/\.[^.]+$/, ''), createdAt: new Date().toISOString(), status: 'queued', message: 'Waiting for the local worker…', scriptProvider, voiceProvider };
      await store.save(episode);
      try { await writeFile(path.join(store.folder(id), 'source'), req.file.buffer, { mode: 0o600 }); }
      catch { await store.remove(id); throw new UserError('Could not save the source. Check disk space.', 507); }
      queue.push(id); processQueue();
      res.status(202).json(episode);
    } finally { reservations--; }
  });
  app.post('/api/episodes/:id/retry', async (req, res) => {
    if (retrying.has(req.params.id)) throw new UserError('This episode is already being retried.', 409);
    if (req.episode.status !== 'failed') throw new UserError('Only failed episodes can be retried.', 409);
    if (pending() >= 3) throw new UserError('The queue is full. Try again when a recording finishes.', 429);
    retrying.add(req.params.id); reservations++;
    try {
      await diskCheck();
      const episode = await store.save({ ...req.episode, script: undefined, audio: undefined, status: 'queued', message: 'Waiting to retry…' });
      queue.push(episode.id); processQueue(); res.status(202).json(episode);
    } finally { reservations--; retrying.delete(req.params.id); }
  });
  app.delete('/api/episodes/:id', async (req, res) => {
    if (retrying.has(req.params.id)) throw new UserError('This episode is being retried.', 409);
    if (!['ready', 'failed'].includes(req.episode.status)) throw new UserError('Wait for generation to finish before deleting.', 409);
    await store.remove(req.params.id); res.status(204).end();
  });
  app.use('/api', (_req, _res, next) => next(new UserError('Endpoint not found.', 404)));
  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));
  app.use((error, _req, res, _next) => {
    if (error instanceof multer.MulterError) return res.status(413).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'This file exceeds the 20 MB upload limit.' : 'Upload one file with the supported settings.' });
    res.status(error instanceof UserError ? error.status : 500).json({ error: error instanceof UserError ? error.message : 'The app could not complete this request. Check disk space and retry.' });
  });
  return { app, store, close: async () => { closing = true; if (active) await active.terminate(); } };
}
