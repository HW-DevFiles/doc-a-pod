import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import http from 'node:http';
import { createApp } from '../src/app.js';
import { configuration } from '../src/config.js';
import { EpisodeStore } from '../src/store.js';
import { PAPER, pdfFixture } from './helpers.js';

async function withServer(fn, env = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'docapod-app-'));
  const runtime = await createApp(configuration({DATA_DIR:directory,SCRIPT_PROVIDER:'demo',VOICE_PROVIDER:'demo',...env}));
  const server = runtime.app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base, runtime); }
  finally { await runtime.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(directory,{recursive:true,force:true}); }
}
async function terminalEpisode(base, id) {
  for (let i=0; i<100; i++) {
    const episode = await (await fetch(`${base}/api/episodes/${id}`)).json();
    if (['ready','failed'].includes(episode.status)) return episode;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Episode did not finish');
}
function upload(base, data, name) {
  const form = new FormData(); form.append('paper', new Blob([data]), name);
  return fetch(`${base}/api/episodes`, {method:'POST', headers:{'X-Docapod':'1'}, body:form});
}
test('PDF upload -> script -> playable ranged audio -> restart library -> delete', async () => {
  await withServer(async (base, runtime) => {
    const response = await upload(base, pdfFixture(), 'walking.pdf'); assert.equal(response.status,202);
    const {id} = await response.json(); const episode = await terminalEpisode(base,id);
    assert.equal(episode.status,'ready', episode.message); assert.equal(episode.sourcePages,1);
    assert.ok(episode.script.words <= 5000); assert.equal(episode.audio.timeline.length,8);
    const audio = await fetch(`${base}/api/episodes/${id}/audio`, {headers:{Range:'bytes=0-43'}});
    assert.equal(audio.status,206); assert.match(audio.headers.get('content-type'), /audio\/wav/); assert.equal((await audio.arrayBuffer()).byteLength,44);
    const download = await fetch(`${base}/api/episodes/${id}/audio?download=1`); assert.match(download.headers.get('content-disposition'), /attachment/); await download.arrayBuffer();
    const reloaded = new EpisodeStore(runtime.store.directory); await reloaded.init(); assert.equal(reloaded.list()[0].id,id); assert.equal(reloaded.list()[0].status,'ready');
    const list = await (await fetch(`${base}/api/episodes`)).json(); assert.equal(list.length,1); assert.equal(list[0].pages,1);
    assert.equal((await fetch(`${base}/api/episodes/${id}`, {method:'DELETE',headers:{'X-Docapod':'1'}})).status,204);
    assert.equal((await fetch(`${base}/api/episodes/${id}`)).status,404);
  });
});
test('failed extraction is visible and can retry without killing the queue', async () => {
  await withServer(async base => {
    const response = await upload(base, 'not a pdf', 'bad.pdf'); const {id} = await response.json();
    const episode = await terminalEpisode(base,id); assert.equal(episode.status,'failed'); assert.match(episode.message,/valid PDF/);
    assert.equal((await fetch(`${base}/api/episodes/${id}/audio`)).status,409);
    assert.equal((await fetch(`${base}/api/episodes/${id}/retry`,{method:'POST',headers:{'X-Docapod':'1'}})).status,202);
    assert.equal((await terminalEpisode(base,id)).status,'failed');
    const next = await upload(base, PAPER, 'good.md'); assert.equal((await terminalEpisode(base,(await next.json()).id)).status,'ready');
  });
});
test('API protects provider settings and rejects unwanted requests', async () => {
  await withServer(async base => {
    const settings = await (await fetch(`${base}/api/settings`)).json(); assert.equal(settings.elevenlabsAvailable,false); assert.equal(settings.elevenKey,undefined);
    assert.equal((await fetch(`${base}/api/episodes`,{method:'POST'})).status,403);
    assert.equal((await fetch(`${base}/api/episodes`,{method:'POST',headers:{'X-Docapod':'1',Origin:'https://attacker.example'}})).status,403);
    const form = new FormData(); form.append('paper',new Blob([PAPER]),'paper.txt'); form.append('voiceProvider','elevenlabs');
    const denied = await fetch(`${base}/api/episodes`,{method:'POST',headers:{'X-Docapod':'1'},body:form}); assert.equal(denied.status,400);
    assert.equal((await upload(base,PAPER,'paper.html')).status,400);
    const manifest = await (await fetch(`${base}/manifest.webmanifest`)).json(); assert.equal(manifest.display,'standalone');
    for (const icon of manifest.icons) assert.equal((await fetch(base + icon.src)).status,200);
  });
});
function responseFor(base, host, pathname = '/api/episodes', method = 'GET') {
  const headers = method === 'GET' ? {Host:host} : {Host:host, 'X-Docapod':'1', Origin:`http://${host}`};
  return new Promise((resolve, reject) => {
    http.request(`${base}${pathname}`, {method, headers}, response => { response.resume(); resolve(response); }).on('error', reject).end();
  });
}
const statusFor = async (...args) => (await responseFor(...args)).statusCode;
test('API rejects unknown Host headers to block DNS rebinding', async () => {
  await withServer(async base => {
    for (const host of ['localhost:3000','127.0.0.1:3000','[::1]:3000','192.168.1.20:3000','100.101.102.103','mac-mini.local:3000','mac-mini.tail1234.ts.net','Papers.Example']) assert.equal(await statusFor(base, host), 200, host);
    for (const host of ['attacker.example','attacker.example:3000','127.0.0.1.attacker.example','evil-local','ts.net.attacker.example']) {
      assert.equal(await statusFor(base, host), 403, host);
      assert.equal(await statusFor(base, host, '/api/episodes/12345678-1234-1234-1234-123456789012/audio'), 403, host);
    }
    const id = '12345678-1234-1234-1234-123456789012';
    for (const [pathname, method] of [['/API/episodes'], ['/Api/settings'], [`/API/Episodes/${id}`], [`/aPi/episodes/${id}/AUDIO`], ['/API/episodes', 'POST'], [`/Api/episodes/${id}/retry`, 'POST'], [`/API/episodes/${id}`, 'DELETE']]) {
      const response = await responseFor(base, 'attacker.example', pathname, method);
      assert.equal(response.statusCode, 403, `${method || 'GET'} ${pathname}`); assert.equal(response.headers['cache-control'], 'no-store');
    }
    const allowed = await responseFor(base, 'localhost', '/API/Settings'); assert.equal(allowed.statusCode, 200); assert.equal(allowed.headers['cache-control'], 'no-store');
  }, {ALLOWED_HOSTS:' papers.example , other.example'});
});
test('restart marks interrupted generation as retryable', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(),'docapod-restart-'));
  try {
    const store = new EpisodeStore(directory); await store.init();
    await store.save({id:'12345678-1234-1234-1234-123456789012',status:'working',createdAt:new Date().toISOString()});
    const reloaded = new EpisodeStore(directory); await reloaded.init();
    assert.equal(reloaded.list()[0].status,'failed'); assert.match(reloaded.list()[0].message,/restarted/);
  } finally { await rm(directory,{recursive:true,force:true}); }
});
