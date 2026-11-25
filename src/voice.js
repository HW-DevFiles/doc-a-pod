import { open, rename, rm } from 'node:fs/promises';
import { elevenReady, UserError } from './config.js';

export const SAMPLE_RATE = 24000;
export function wavHeader(bytes) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + bytes, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24); header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(bytes, 40);
  return header;
}
export function pcm16(samples) {
  const pcm = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, i) => pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 32767), i * 2));
  return pcm;
}
// Kokoro's tokenizer truncates long inputs. Small word-boundary chunks avoid that.
export function speechChunks(text) {
  const chunks = [];
  let chunk = '';
  for (const word of text.split(/\s+/)) {
    if (word.length > 180) throw new UserError('The script contains a word too long for speech. Retry the script.');
    if (chunk.length + word.length + 1 > 180) { chunks.push(chunk); chunk = ''; }
    chunk += `${chunk ? ' ' : ''}${word}`;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}
export async function createVoice(provider, config, { fetchImpl = fetch, loadKokoro } = {}) {
  if (provider === 'demo') return async (_text, host) => pcm16(Float32Array.from({ length: 4800 }, (_, i) => Math.sin(i * 2 * Math.PI * (host === 'Maya' ? 440 : 330) / SAMPLE_RATE) * 0.12 * Math.sin(Math.PI * i / 4800)));
  if (provider === 'elevenlabs') {
    if (!elevenReady(config)) throw new UserError('ElevenLabs needs an environment key and two distinct voice IDs. Choose local Kokoro to run free.');
    return async (text, host) => {
      let response;
      try {
        response = await fetchImpl(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(config.elevenVoices[host])}?output_format=pcm_24000`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'xi-api-key': config.elevenKey },
          body: JSON.stringify({ text, model_id: config.elevenModel }), signal: AbortSignal.timeout(90_000),
        });
      } catch { throw new UserError('ElevenLabs could not be reached. Check your connection and retry.', 502); }
      // Never log or forward provider response bodies, which could contain secrets.
      if (!response.ok) throw new UserError(`ElevenLabs returned HTTP ${response.status}. Check the key, voices, quota, and plan.`, 502);
      const pcm = Buffer.from(await response.arrayBuffer());
      if (!pcm.length || pcm.length % 2 || pcm.length > SAMPLE_RATE * 2 * 180) throw new UserError('ElevenLabs returned invalid PCM audio.', 502);
      return pcm;
    };
  }
  if (provider !== 'kokoro') throw new UserError('Unknown voice provider.');
  let tts;
  try {
    if (loadKokoro) tts = await loadKokoro();
    else {
      const { env } = await import('@huggingface/transformers');
      env.cacheDir = config.cacheDir;
      const { KokoroTTS } = await import('kokoro-js');
      tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'cpu' });
    }
  } catch { throw new UserError('Could not load Kokoro. First use needs internet and disk space for the quantized model; check the README.', 503); }
  return async (text, host) => {
    const audio = await tts.generate(text, { voice: host === 'Maya' ? 'af_heart' : 'am_michael' });
    if (audio.sampling_rate !== SAMPLE_RATE || !audio.audio?.length) throw new Error('Unexpected Kokoro audio format.');
    return pcm16(audio.audio);
  };
}
export async function synthesizeEpisode(script, provider, config, output, onProgress = () => {}, dependencies) {
  const voice = await createVoice(provider, config, dependencies);
  const temporary = `${output}.partial`;
  const file = await open(temporary, 'w');
  let bytes = 0;
  const timeline = [];
  try {
    await file.write(wavHeader(0));
    for (const [index, line] of script.lines.entries()) {
      onProgress(`Recording ${index + 1} of ${script.lines.length} turns…`, index / script.lines.length);
      timeline.push({ start: bytes / 2 / SAMPLE_RATE, host: line.host });
      for (const text of speechChunks(line.text)) {
        const pcm = await voice(text, line.host);
        bytes += pcm.length;
        if (bytes > SAMPLE_RATE * 2 * 3600) throw new UserError('Audio exceeded the one-hour safety limit. Generate a shorter script.');
        await file.write(pcm);
      }
      const pause = Buffer.alloc(SAMPLE_RATE * 2 * 0.25);
      await file.write(pause); bytes += pause.length;
    }
    await file.write(wavHeader(bytes), 0, 44, 0);
  } catch (error) { await file.close(); await rm(temporary, { force: true }); throw error; }
  await file.close();
  await rename(temporary, output);
  return { seconds: bytes / 2 / SAMPLE_RATE, timeline };
}
