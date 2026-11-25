import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createVoice, speechChunks, synthesizeEpisode, SAMPLE_RATE } from '../src/voice.js';
import { configuration } from '../src/config.js';
import { demoScript } from '../src/script.js';
import { PAPER } from './helpers.js';

test('Kokoro routes hosts to distinct voices and preserves PCM sample format', async () => {
  const voices = [];
  const voice = await createVoice('kokoro', configuration(), {loadKokoro: async () => ({generate: async (_text, options) => {voices.push(options.voice); return {audio: Float32Array.from([-1,0,1]), sampling_rate: SAMPLE_RATE};}})});
  assert.equal((await voice('Hello.', 'Maya')).readInt16LE(0), -32767);
  await voice('Hello.', 'Leo'); assert.deepEqual(voices, ['af_heart','am_michael']);
});
test('speech chunks preserve every word and stay below tokenizer input limits', () => {
  const text = PAPER.repeat(20);
  const chunks = speechChunks(text); assert.ok(chunks.every(c => c.length <= 180));
  assert.equal(chunks.join(' '), text.replace(/\s+/g, ' ').trim());
});
test('ElevenLabs requires a key and distinct voices, keeps secrets out of failures', async () => {
  await assert.rejects(createVoice('elevenlabs', configuration()), /environment key/);
  const config = configuration({ELEVENLABS_API_KEY:'test-secret',ELEVENLABS_VOICE_MAYA:'a',ELEVENLABS_VOICE_LEO:'b'});
  const calls = [];
  const voice = await createVoice('elevenlabs', config, {fetchImpl: async (url, request) => {calls.push([url,request]); return new Response(Buffer.alloc(100));}});
  await voice('Hi.', 'Maya'); await voice('Hello.', 'Leo');
  assert.match(calls[0][0], /\/a\?output_format=pcm_24000/); assert.match(calls[1][0], /\/b\?/);
  assert.equal(calls[0][1].headers['xi-api-key'], 'test-secret');
  const broken = await createVoice('elevenlabs', config, {fetchImpl: async () => new Response('test-secret', {status:401})});
  await assert.rejects(broken('Hi.', 'Maya'), error => /401/.test(error.message) && !error.message.includes('test-secret'));
  await assert.rejects(createVoice('unknown', config), /Unknown/);
});
test('stitches audio into one valid WAV with line timestamps', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'docapod-voice-'));
  try {
    const file = path.join(dir, 'episode.wav'); const script = demoScript(PAPER);
    const audio = await synthesizeEpisode(script, 'demo', configuration(), file);
    const wav = await readFile(file);
    assert.equal(wav.toString('ascii',0,4), 'RIFF'); assert.equal(wav.toString('ascii',8,12), 'WAVE');
    assert.equal(wav.readUInt32LE(40), wav.length - 44); assert.equal(wav.readUInt32LE(24),24000);
    assert.equal(audio.timeline.length, script.lines.length); assert.equal(audio.timeline[0].start,0);
    assert.ok(audio.timeline[1].start > 0); assert.equal(audio.seconds,(wav.length-44)/48000);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
