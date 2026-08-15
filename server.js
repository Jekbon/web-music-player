/**
 * Web 音乐播放器服务端（零依赖，Node 原生 http）
 *
 * 功能：
 * - 静态托管前端单页（public/）
 * - 曲库扫描 API、流式播放（HTTP Range）、歌词获取、网页上传、歌单 CRUD
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanLibrary, isAudioFile, trackId, MIME_BY_EXT, AUDIO_EXTENSIONS } from './lib/scanner.js';
import { getBoundary, parseMultipart } from './lib/multipart.js';
import { PlaylistStore } from './lib/playlists.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = parseInt(process.env.PORT ?? '8787', 10);
const HOST = process.env.HOST ?? '0.0.0.0';
const MUSIC_DIR = path.resolve(process.env.MUSIC_DIR ?? path.join(__dirname, 'music'));
const DATA_DIR = path.resolve(process.env.DATA_DIR ?? path.join(__dirname, 'data'));
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_UPLOAD_SIZE = 200 * 1024 * 1024; // 200MB

fs.mkdirSync(MUSIC_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

// ─── 状态 ───────────────────────────────────────────────────
let tracks = scanLibrary(MUSIC_DIR);
const trackById = () => new Map(tracks.map((t) => [t.id, t]));
const playlists = new PlaylistStore(path.join(DATA_DIR, 'playlists.json'));

// ─── 工具 ───────────────────────────────────────────────────
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req, limit = MAX_UPLOAD_SIZE) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('payload_too_large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** 安全文件名：剥离路径，防穿越；同名追加序号 */
function safeUniqueFilename(dir, rawName) {
  const base = path.basename(String(rawName).replace(/\\/gu, '/'));
  if (!base || base.startsWith('.')) return null;
  let candidate = base;
  let n = 1;
  while (fs.existsSync(path.join(dir, candidate))) {
    const ext = path.extname(base);
    const stem = path.basename(base, ext);
    candidate = `${stem} (${n})${ext}`;
    n += 1;
  }
  return candidate;
}

// ─── API 路由 ────────────────────────────────────────────────
async function handleApi(req, res, url) {
  const p = url.pathname;

  // 曲库列表
  if (req.method === 'GET' && p === '/api/library') {
    const folders = [...new Set(tracks.map((t) => t.folder))].sort((a, b) => a.localeCompare(b, 'zh'));
    return sendJson(res, 200, { tracks, folders });
  }

  // 流式播放（Range 支持）
  const streamMatch = /^\/api\/stream\/([a-f0-9]+)$/u.exec(p);
  if (req.method === 'GET' && streamMatch) {
    const track = trackById().get(streamMatch[1]);
    if (!track) return sendJson(res, 404, { error: 'not_found' });
    const filePath = path.join(MUSIC_DIR, track.path);
    if (!fs.existsSync(filePath)) return sendJson(res, 404, { error: 'file_missing' });
    const stat = fs.statSync(filePath);
    const mime = MIME_BY_EXT[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
    const range = req.headers.range;
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/u.exec(range.trim());
      if (!m) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
        return res.end();
      }
      let start = m[1] ? parseInt(m[1], 10) : 0;
      let end = m[2] ? parseInt(m[2], 10) : stat.size - 1;
      if (m[1] === '' && m[2] !== '') {
        // suffix range: bytes=-N 最后 N 字节
        start = Math.max(0, stat.size - parseInt(m[2], 10));
        end = stat.size - 1;
      }
      if (start > end || start >= stat.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
        return res.end();
      }
      end = Math.min(end, stat.size - 1);
      res.writeHead(206, {
        'Content-Type': mime,
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Content-Length': end - start + 1,
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, {
      'Content-Type': mime,
      'Accept-Ranges': 'bytes',
      'Content-Length': stat.size,
    });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  // 歌词获取
  const lyricsMatch = /^\/api\/lyrics\/([a-f0-9]+)$/u.exec(p);
  if (req.method === 'GET' && lyricsMatch) {
    const track = trackById().get(lyricsMatch[1]);
    if (!track) return sendJson(res, 404, { error: 'not_found' });
    const audioPath = path.join(MUSIC_DIR, track.path);
    const lrcPath = audioPath.slice(0, -path.extname(audioPath).length) + '.lrc';
    if (fs.existsSync(lrcPath)) {
      try {
        return sendJson(res, 200, { found: true, text: fs.readFileSync(lrcPath, 'utf-8') });
      } catch {
        return sendJson(res, 200, { found: false });
      }
    }
    return sendJson(res, 200, { found: false });
  }

  // 删除曲目（物理删除文件）
  const trackDelMatch = /^\/api\/tracks\/([a-f0-9]+)$/u.exec(p);
  if (req.method === 'DELETE' && trackDelMatch) {
    const track = trackById().get(trackDelMatch[1]);
    if (!track) return sendJson(res, 404, { error: 'not_found' });
    const filePath = path.resolve(MUSIC_DIR, track.path);
    // 防路径穿越：解析后必须仍在音乐目录内
    if (!filePath.startsWith(MUSIC_DIR + path.sep)) {
      return sendJson(res, 400, { error: 'invalid_path' });
    }
    const lrcPath = filePath.slice(0, -path.extname(filePath).length) + '.lrc';
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      return sendJson(res, 500, { error: 'delete_failed' });
    }
    try {
      if (fs.existsSync(lrcPath)) fs.unlinkSync(lrcPath);
    } catch { /* lrc 删除失败不阻塞主流程 */ }
    // 从曲库缓存移除
    tracks = tracks.filter((t) => t.id !== track.id);
    // 清理所有歌单中的引用
    for (const pl of playlists.list()) {
      if (pl.trackIds.includes(track.id)) playlists.removeTrack(pl.id, track.id);
    }
    return sendJson(res, 200, { ok: true });
  }

  // 上传
  if (req.method === 'POST' && p === '/api/upload') {
    const boundary = getBoundary(req.headers['content-type'] ?? '');
    if (!boundary) return sendJson(res, 400, { error: 'invalid_content_type' });
    let body;
    try {
      body = await readBody(req);
    } catch {
      return sendJson(res, 413, { error: 'payload_too_large' });
    }
    const parts = parseMultipart(body, boundary);
    const filePart = parts.find((x) => x.filename !== null && x.filename !== undefined);
    if (!filePart) return sendJson(res, 400, { error: 'missing_file' });
    if (!isAudioFile(filePart.filename)) {
      return sendJson(res, 400, { error: 'unsupported_format', allowed: AUDIO_EXTENSIONS });
    }
    const filename = safeUniqueFilename(MUSIC_DIR, filePart.filename);
    if (!filename) return sendJson(res, 400, { error: 'invalid_filename' });
    const dest = path.join(MUSIC_DIR, filename);
    // 二次校验：目标必须仍在 MUSIC_DIR 内
    if (!dest.startsWith(MUSIC_DIR + path.sep) && dest !== MUSIC_DIR) {
      return sendJson(res, 400, { error: 'invalid_filename' });
    }
    fs.writeFileSync(dest, filePart.data);
    // 增量刷新曲库
    tracks = scanLibrary(MUSIC_DIR);
    const rel = path.relative(MUSIC_DIR, dest).split(path.sep).join('/');
    const created = tracks.find((t) => t.path === rel) ?? null;
    return sendJson(res, 201, { ok: true, track: created });
  }

  // 歌单
  if (p === '/api/playlists' && req.method === 'GET') {
    return sendJson(res, 200, { playlists: playlists.list() });
  }
  if (p === '/api/playlists' && req.method === 'POST') {
    const body = await readBody(req, 1024 * 1024).catch(() => null);
    if (!body) return sendJson(res, 413, { error: 'payload_too_large' });
    let name;
    try {
      name = JSON.parse(body.toString('utf-8')).name;
    } catch {
      return sendJson(res, 400, { error: 'invalid_json' });
    }
    const r = playlists.create(name);
    if (r.error === 'empty_name') return sendJson(res, 400, { error: 'empty_name' });
    if (r.error === 'duplicate_name') return sendJson(res, 409, { error: 'duplicate_name' });
    return sendJson(res, 201, r.playlist);
  }
  const plMatch = /^\/api\/playlists\/([0-9a-f-]+)(?:\/tracks(?:\/([a-f0-9]+))?)?$/u.exec(p);
  if (plMatch) {
    const [, plId, trackIdParam] = plMatch;
    if (req.method === 'PUT' && !plMatch[0].includes('/tracks')) {
      const body = await readBody(req, 1024 * 1024).catch(() => null);
      if (!body) return sendJson(res, 413, { error: 'payload_too_large' });
      let name;
      try {
        name = JSON.parse(body.toString('utf-8')).name;
      } catch {
        return sendJson(res, 400, { error: 'invalid_json' });
      }
      const r = playlists.rename(plId, name);
      if (r.error === 'not_found') return sendJson(res, 404, { error: 'not_found' });
      if (r.error === 'empty_name') return sendJson(res, 400, { error: 'empty_name' });
      if (r.error === 'duplicate_name') return sendJson(res, 409, { error: 'duplicate_name' });
      return sendJson(res, 200, r.playlist);
    }
    if (req.method === 'DELETE' && !plMatch[0].includes('/tracks')) {
      const r = playlists.remove(plId);
      if (r.error) return sendJson(res, 404, { error: 'not_found' });
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'POST' && plMatch[0].endsWith('/tracks')) {
      const body = await readBody(req, 1024 * 1024).catch(() => null);
      if (!body) return sendJson(res, 413, { error: 'payload_too_large' });
      let tid;
      try {
        tid = JSON.parse(body.toString('utf-8')).trackId;
      } catch {
        return sendJson(res, 400, { error: 'invalid_json' });
      }
      if (!tid) return sendJson(res, 400, { error: 'missing_track_id' });
      const r = playlists.addTrack(plId, tid);
      if (r.error) return sendJson(res, 404, { error: 'not_found' });
      return sendJson(res, 200, r.playlist);
    }
    if (req.method === 'DELETE' && trackIdParam) {
      const r = playlists.removeTrack(plId, trackIdParam);
      if (r.error) return sendJson(res, 404, { error: 'not_found' });
      return sendJson(res, 200, r.playlist);
    }
  }

  return sendJson(res, 404, { error: 'not_found' });
}

// ─── 静态文件 ────────────────────────────────────────────────
function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not Found');
    }
    const ext = path.extname(filePath).toLowerCase();
    const mime =
      { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' }[ext] ??
      'application/octet-stream';
    // 前端资源不缓存，确保更新后立即生效（个人单机场景，无 CDN 需求）
    res.writeHead(200, { 'Content-Type': mime, 'Content-Length': stat.size, 'Cache-Control': 'no-store' });
    fs.createReadStream(filePath).pipe(res);
  });
}

// ─── 服务 ───────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendJson(res, 405, { error: 'method_not_allowed' });
    }
    serveStatic(res, url.pathname);
  } catch (err) {
    if (!res.headersSent) sendJson(res, 500, { error: 'internal_error' });
    else res.end();
    console.error('[server] unhandled error:', err);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`🎵 Web 音乐播放器已启动`);
  console.log(`   本机访问: http://localhost:${PORT}`);
  console.log(`   局域网访问: http://<本机IP>:${PORT}`);
  console.log(`   音乐目录: ${MUSIC_DIR}（已收录 ${tracks.length} 首）`);
});

export { server, MUSIC_DIR, DATA_DIR };
