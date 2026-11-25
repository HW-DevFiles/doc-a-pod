import path from 'node:path';

export const LIMITS = Object.freeze({ uploadBytes: 20 * 1024 * 1024, sourcePages: 100, sourceChars: 500_000, wordsPerPage: 500, scriptWords: 5000 });
export function configuration(env = process.env) {
  return {
    host: env.HOST || '0.0.0.0', port: Number(env.PORT || 3000),
    dataDir: path.resolve(env.DATA_DIR || 'data'), cacheDir: path.resolve(env.MODEL_CACHE_DIR || '.cache'),
    scriptProvider: env.SCRIPT_PROVIDER || 'ollama', voiceProvider: env.VOICE_PROVIDER || 'kokoro',
    ollamaUrl: env.OLLAMA_URL || 'http://127.0.0.1:11434', ollamaModel: env.OLLAMA_MODEL || 'qwen3.5:9b',
    elevenKey: env.ELEVENLABS_API_KEY || '', elevenModel: env.ELEVENLABS_MODEL || 'eleven_multilingual_v2',
    elevenVoices: { Maya: env.ELEVENLABS_VOICE_MAYA || '', Leo: env.ELEVENLABS_VOICE_LEO || '' },
  };
}
export function elevenReady(config) {
  return Boolean(config.elevenKey && config.elevenVoices.Maya && config.elevenVoices.Leo && config.elevenVoices.Maya !== config.elevenVoices.Leo);
}
export class UserError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
