/**
 * 曲库扫描器：递归扫描音乐目录，解析元数据，生成曲目记录。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseId3v2 } from './id3.js';

export const AUDIO_EXTENSIONS = ['.mp3', '.m4a', '.ogg', '.wav', '.flac'];

export const MIME_BY_EXT = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
};

/** 判断文件是否为音频（白名单后缀，大小写不敏感） */
export function isAudioFile(filename) {
  return AUDIO_EXTENSIONS.includes(path.extname(filename).toLowerCase());
}

/** 由相对路径生成稳定 id */
export function trackId(relPath) {
  return crypto.createHash('sha256').update(relPath).digest('hex').slice(0, 16);
}

/** 文件名（去后缀）作为回退标题 */
export function fallbackTitle(filename) {
  return path.basename(filename, path.extname(filename));
}

/**
 * 递归扫描目录。
 * @param {string} root 音乐目录绝对路径
 * @returns {Array<object>} 曲目数组（未排序）
 */
export function scanLibrary(root) {
  const tracks = [];
  if (!fs.existsSync(root)) return tracks;

  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue; // 忽略隐藏文件/目录
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && isAudioFile(entry.name)) {
        const rel = path.relative(root, full).split(path.sep).join('/');
        const folder = path.posix.dirname(rel) || '.';
        let title = null;
        let artist = null;
        let album = null;
        if (path.extname(entry.name).toLowerCase() === '.mp3') {
          try {
            // 只读取前 512KB 解析标签，避免大文件全量读入
            const fd = fs.openSync(full, 'r');
            const buf = Buffer.alloc(Math.min(512 * 1024, fs.fstatSync(fd).size));
            fs.readSync(fd, buf, 0, buf.length, 0);
            fs.closeSync(fd);
            const tags = parseId3v2(buf);
            title = tags.title;
            artist = tags.artist;
            album = tags.album;
          } catch {
            /* 解析失败回退文件名 */
          }
        }
        let size = 0;
        try {
          size = fs.statSync(full).size;
        } catch {
          /* ignore */
        }
        tracks.push({
          id: trackId(rel),
          title: title || fallbackTitle(entry.name),
          artist: artist || '',
          album: album || '',
          folder,
          path: rel,
          size,
          duration: null,
        });
      }
    }
  };

  walk(root);
  tracks.sort((a, b) =>
    a.folder === b.folder ? a.title.localeCompare(b.title, 'zh') : a.folder.localeCompare(b.folder, 'zh'),
  );
  return tracks;
}
