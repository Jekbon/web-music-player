/**
 * 歌单存储：JSON 文件持久化（data/playlists.json）。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class PlaylistStore {
  /**
   * @param {string} filePath playlists.json 的绝对路径
   */
  constructor(filePath) {
    this.filePath = filePath;
    this.playlists = [];
    this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const data = JSON.parse(raw);
      if (Array.isArray(data.playlists)) this.playlists = data.playlists;
    } catch {
      this.playlists = [];
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ playlists: this.playlists }, null, 2));
    fs.renameSync(tmp, this.filePath);
  }

  list() {
    return this.playlists;
  }

  get(id) {
    return this.playlists.find((p) => p.id === id) ?? null;
  }

  create(name) {
    const trimmed = String(name ?? '').trim();
    if (!trimmed) return { error: 'empty_name' };
    if (this.playlists.some((p) => p.name === trimmed)) return { error: 'duplicate_name' };
    const playlist = {
      id: crypto.randomUUID(),
      name: trimmed,
      trackIds: [],
      createdAt: new Date().toISOString(),
    };
    this.playlists.push(playlist);
    this.save();
    return { playlist };
  }

  rename(id, name) {
    const trimmed = String(name ?? '').trim();
    if (!trimmed) return { error: 'empty_name' };
    const target = this.get(id);
    if (!target) return { error: 'not_found' };
    if (this.playlists.some((p) => p.id !== id && p.name === trimmed)) return { error: 'duplicate_name' };
    target.name = trimmed;
    this.save();
    return { playlist: target };
  }

  remove(id) {
    const idx = this.playlists.findIndex((p) => p.id === id);
    if (idx === -1) return { error: 'not_found' };
    this.playlists.splice(idx, 1);
    this.save();
    return { ok: true };
  }

  addTrack(id, trackId) {
    const playlist = this.get(id);
    if (!playlist) return { error: 'not_found' };
    if (!playlist.trackIds.includes(trackId)) {
      playlist.trackIds.push(trackId);
      this.save();
    }
    return { playlist }; // 幂等
  }

  removeTrack(id, trackId) {
    const playlist = this.get(id);
    if (!playlist) return { error: 'not_found' };
    playlist.trackIds = playlist.trackIds.filter((t) => t !== trackId);
    this.save();
    return { playlist };
  }
}
