import { mkdir, readdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

export class EpisodeStore {
  constructor(directory) { this.directory = directory; this.episodes = new Map(); }
  folder(id) { return path.join(this.directory, id); }
  async init() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    for (const name of await readdir(this.directory)) {
      if (!/^[\da-f-]{36}$/.test(name)) continue;
      let episode;
      try { episode = JSON.parse(await readFile(path.join(this.folder(name), 'metadata.json'), 'utf8')); }
      catch { continue; }
      if (episode.id !== name) continue;
      this.episodes.set(name, episode);
      if (!['ready', 'failed'].includes(episode.status)) await this.save({ ...episode, status: 'failed', message: 'The app restarted during generation. Retry this episode.' });
      await rm(path.join(this.folder(name), 'episode.wav.partial'), { force: true });
    }
  }
  list() { return [...this.episodes.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  async save(episode) {
    await mkdir(this.folder(episode.id), { recursive: true, mode: 0o700 });
    const file = path.join(this.folder(episode.id), 'metadata.json');
    await writeFile(`${file}.tmp`, JSON.stringify(episode), { mode: 0o600 });
    await rename(`${file}.tmp`, file);
    this.episodes.set(episode.id, episode);
    return episode;
  }
  async remove(id) { await rm(this.folder(id), { recursive: true, force: true }); this.episodes.delete(id); }
}
