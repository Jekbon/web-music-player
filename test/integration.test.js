/**
 * 集成测试：启动真实服务进程，验证 library/stream/upload/playlists/lyrics 端点。
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestLibrary, buildTaggedMp3, buildMultipart } from './helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PORT = 18799;
const BASE = `http://127.0.0.1:${PORT}`;

let proc;
let musicDir;
let dataDir;

async function waitForServer(timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/api/library`);
      if (res.ok) return;
    } catch { /* 未就绪 */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('服务启动超时');
}

before(async () => {
  musicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmp-music-'));
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmp-data-'));
  createTestLibrary(musicDir);
  proc = spawn(process.execPath, ['server.js'], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, PORT: String(PORT), MUSIC_DIR: musicDir, DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForServer();
});

after(() => {
  if (proc) proc.kill('SIGTERM');
  fs.rmSync(musicDir, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('GET /api/library 返回曲目列表且字段完整', async () => {
  const res = await fetch(`${BASE}/api/library`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data.tracks));
  assert.ok(Array.isArray(data.folders));
  assert.equal(data.tracks.length, 4);
  const t = data.tracks.find((x) => x.path === '华语/周杰伦/晴天.mp3');
  assert.ok(t);
  for (const key of ['id', 'title', 'artist', 'album', 'folder', 'path']) {
    assert.ok(key in t, `缺少字段 ${key}`);
  }
  assert.equal(t.title, '晴天');
  assert.ok(data.folders.includes('华语/周杰伦'));
});

test('GET /api/stream/:id 无 Range 返回 200 完整内容', async () => {
  const lib = await (await fetch(`${BASE}/api/library`)).json();
  const t = lib.tracks.find((x) => x.path === '欧美/song.ogg');
  const res = await fetch(`${BASE}/api/stream/${t.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'audio/ogg');
  assert.equal(res.headers.get('accept-ranges'), 'bytes');
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.length, 256);
});

test('GET /api/stream/:id 带 Range 返回 206 与正确 Content-Range', async () => {
  const lib = await (await fetch(`${BASE}/api/library`)).json();
  const t = lib.tracks.find((x) => x.path === '欧美/song.ogg');
  const res = await fetch(`${BASE}/api/stream/${t.id}`, { headers: { Range: 'bytes=10-19' } });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-range'), 'bytes 10-19/256');
  assert.equal(res.headers.get('content-length'), '10');
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.length, 10);
});

test('GET /api/stream/:id 未知 id 返回 404', async () => {
  const res = await fetch(`${BASE}/api/stream/deadbeefdeadbeef`);
  assert.equal(res.status, 404);
});

test('POST /api/upload 上传 mp3 成功并出现在曲库', async () => {
  const boundary = '----wmp-test';
  const mp3 = buildTaggedMp3({ title: '上传测试', artist: '测试员', album: '测试专辑' });
  const body = buildMultipart(boundary, { filename: '上传测试.mp3', data: mp3 });
  const res = await fetch(`${BASE}/api/upload`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body,
  });
  assert.equal(res.status, 201);
  const data = await res.json();
  assert.ok(data.ok);
  assert.ok(fs.existsSync(path.join(musicDir, '上传测试.mp3')));

  const lib = await (await fetch(`${BASE}/api/library`)).json();
  const uploaded = lib.tracks.find((x) => x.path === '上传测试.mp3');
  assert.ok(uploaded, '上传后应出现在曲库');
  assert.equal(uploaded.title, '上传测试');
});

test('POST /api/upload 非白名单后缀被拒绝 400', async () => {
  const boundary = '----wmp-test2';
  const body = buildMultipart(boundary, { filename: 'evil.exe', data: Buffer.from('x') });
  const res = await fetch(`${BASE}/api/upload`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body,
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.error, 'unsupported_format');
});

test('上传文件名含路径分隔符时只写入目录根（防穿越）', async () => {
  const boundary = '----wmp-test3';
  const body = buildMultipart(boundary, { filename: '../../escape.mp3', data: buildTaggedMp3({ title: 't' }) });
  const res = await fetch(`${BASE}/api/upload`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body,
  });
  assert.equal(res.status, 201);
  assert.ok(fs.existsSync(path.join(musicDir, 'escape.mp3')));
  assert.ok(!fs.existsSync(path.resolve(musicDir, '..', 'escape.mp3')));
});

test('歌单 CRUD 全流程且落盘', async () => {
  // 创建
  let res = await fetch(`${BASE}/api/playlists`, { method: 'POST', body: JSON.stringify({ name: '我的最爱' }) });
  assert.equal(res.status, 201);
  const pl = await res.json();
  assert.ok(pl.id);
  assert.equal(pl.name, '我的最爱');

  // 重名 409
  res = await fetch(`${BASE}/api/playlists`, { method: 'POST', body: JSON.stringify({ name: '我的最爱' }) });
  assert.equal(res.status, 409);

  // 列表
  res = await fetch(`${BASE}/api/playlists`);
  let data = await res.json();
  assert.equal(data.playlists.length, 1);

  // 添加曲目
  const lib = await (await fetch(`${BASE}/api/library`)).json();
  const tid = lib.tracks[0].id;
  res = await fetch(`${BASE}/api/playlists/${pl.id}/tracks`, { method: 'POST', body: JSON.stringify({ trackId: tid }) });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.deepEqual(data.trackIds, [tid]);

  // 重复添加幂等
  res = await fetch(`${BASE}/api/playlists/${pl.id}/tracks`, { method: 'POST', body: JSON.stringify({ trackId: tid }) });
  data = await res.json();
  assert.deepEqual(data.trackIds, [tid]);

  // 重命名
  res = await fetch(`${BASE}/api/playlists/${pl.id}`, { method: 'PUT', body: JSON.stringify({ name: '珍藏' }) });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).name, '珍藏');

  // 移除曲目
  res = await fetch(`${BASE}/api/playlists/${pl.id}/tracks/${tid}`, { method: 'DELETE' });
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).trackIds, []);

  // 落盘验证
  const raw = JSON.parse(fs.readFileSync(path.join(dataDir, 'playlists.json'), 'utf-8'));
  assert.equal(raw.playlists.length, 1);
  assert.equal(raw.playlists[0].name, '珍藏');

  // 删除
  res = await fetch(`${BASE}/api/playlists/${pl.id}`, { method: 'DELETE' });
  assert.equal(res.status, 200);
  res = await fetch(`${BASE}/api/playlists/${pl.id}`, { method: 'DELETE' });
  assert.equal(res.status, 404);
});

test('GET /api/lyrics/:id 同名 lrc 存在时返回歌词', async () => {
  const lib = await (await fetch(`${BASE}/api/library`)).json();
  const withLrc = lib.tracks.find((x) => x.path === '欧美/song.ogg');
  let res = await fetch(`${BASE}/api/lyrics/${withLrc.id}`);
  let data = await res.json();
  assert.equal(data.found, true);
  assert.ok(data.text.includes('hello'));

  const noLrc = lib.tracks.find((x) => x.path === '华语/周杰伦/晴天.mp3');
  res = await fetch(`${BASE}/api/lyrics/${noLrc.id}`);
  data = await res.json();
  assert.equal(data.found, false);
});

test('DELETE /api/tracks/:id 物理删除文件并清理引用', async () => {
  const lib = await (await fetch(`${BASE}/api/library`)).json();
  const target = lib.tracks.find((x) => x.path === '欧美/song.ogg');
  assert.ok(target);
  const filePath = path.join(musicDir, target.path);
  const lrcPath = filePath.slice(0, -path.extname(filePath).length) + '.lrc';
  assert.ok(fs.existsSync(filePath));
  assert.ok(fs.existsSync(lrcPath));

  // 先加入歌单，验证删除后引用被清理
  let res = await fetch(`${BASE}/api/playlists`, { method: 'POST', body: JSON.stringify({ name: '删除测试歌单' }) });
  const pl = await res.json();
  res = await fetch(`${BASE}/api/playlists/${pl.id}/tracks`, { method: 'POST', body: JSON.stringify({ trackId: target.id }) });
  assert.equal(res.status, 200);

  // 删除
  res = await fetch(`${BASE}/api/tracks/${target.id}`, { method: 'DELETE' });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);

  // 文件与 lrc 均被物理删除
  assert.ok(!fs.existsSync(filePath));
  assert.ok(!fs.existsSync(lrcPath));

  // 曲库中消失
  const lib2 = await (await fetch(`${BASE}/api/library`)).json();
  assert.ok(!lib2.tracks.some((t) => t.id === target.id));

  // 歌单引用被清理
  res = await fetch(`${BASE}/api/playlists`);
  const pls = (await res.json()).playlists;
  assert.deepEqual(pls.find((p) => p.id === pl.id).trackIds, []);

  // 未知 id 返回 404
  res = await fetch(`${BASE}/api/tracks/deadbeefdeadbeef`, { method: 'DELETE' });
  assert.equal(res.status, 404);

  // 文件已不存在但仍在曲库时幂等成功
  const other = lib2.tracks.find((t) => t.path === '欧美/track.FLAC');
  fs.unlinkSync(path.join(musicDir, other.path));
  res = await fetch(`${BASE}/api/tracks/${other.id}`, { method: 'DELETE' });
  assert.equal(res.status, 200);
  const lib3 = await (await fetch(`${BASE}/api/library`)).json();
  assert.ok(!lib3.tracks.some((t) => t.id === other.id));

  // 清理测试歌单
  await fetch(`${BASE}/api/playlists/${pl.id}`, { method: 'DELETE' });
});

test('静态页面可访问', async () => {
  const res = await fetch(`${BASE}/`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('音乐'));
  assert.ok(html.includes('id="full-player"'));
  assert.ok(res.headers.get('content-type').includes('text/html'));
});
