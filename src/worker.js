import { parentPort, workerData } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { extractDocument } from './extract.js';
import { writeScript } from './script.js';
import { synthesizeEpisode } from './voice.js';
import { UserError } from './config.js';

const { episode, directory, config } = workerData;
const progress = message => parentPort.postMessage({ type: 'progress', message });
try {
  progress('Extracting the paper…');
  const source = await extractDocument(await readFile(path.join(directory, 'source')), episode.filename);
  const script = await writeScript(source.text, episode.scriptProvider, config, { onProgress: progress });
  parentPort.postMessage({ type: 'script', script, sourcePages: source.pages });
  progress(episode.voiceProvider === 'kokoro' ? 'Loading Kokoro (first use downloads the voice model)…' : 'Preparing audio…');
  const audio = await synthesizeEpisode(script, episode.voiceProvider, config, path.join(directory, 'episode.wav'), progress);
  parentPort.postMessage({ type: 'complete', audio });
} catch (error) {
  parentPort.postMessage({ type: 'failed', error: error instanceof UserError ? error.message : 'Generation failed. Check local model availability and disk space, then retry.' });
}
