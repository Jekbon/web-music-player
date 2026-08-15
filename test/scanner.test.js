import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanLibrary, isAudioFile, trackId, fallbackTitle } from '../lib/scanner.js';
import { createTestLibrary } from './helpers.js';

test('scanner: 后缀白名单判断（大小写不敏感）', () => {
  assert.ok(isAudioFile('a.mp3'));
  assert.ok(isAudioFile('a.MP3'));
  assert.ok(isAudioFile('a.Flac'));
  assert.ok(!isAudioFile('a.txt'));
  assert.ok(!isAudioFile('a.mp3.bak'));
});

test('scanner: id 稳定且 fallback 标题正确', () => {
  assert.equal(trackId('a/b.mp3'), trackId('a/b.mp3'));
  assert.notEqual(trackId('a/b.mp3'), trackId('a/c.mp3'));
  assert.equal(fallbackTitle('晴天.mp3'), '晴天');
});

test('scanner: 递归扫描、忽略隐藏文件与目录、仅白名单后缀', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wmp-scan-'));
  try {
    createTestLibrary(root);
    const tracks = scanLibrary(root);
    const paths = tracks.map((t) => t.path).sort();
    assert.deepEqual(paths, [
      '华语/周杰伦/夜曲.mp3',
      '华语/周杰伦/晴天.mp3',
      '欧美/song.ogg',
      '欧美/track.FLAC',
    ]);
    // readme.txt、.hidden.mp3、.hiddendir/x.mp3 均不应出现
    assert.ok(!paths.some((p) => p.includes('readme') || p.includes('hidden')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('scanner: ID3 元数据解析与文件名回退', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wmp-scan-'));
  try {
    createTestLibrary(root);
    const tracks = scanLibrary(root);
    const qingtian = tracks.find((t) => t.path === '华语/周杰伦/晴天.mp3');
    assert.equal(qingtian.title, '晴天');
    assert.equal(qingtian.artist, '周杰伦');
    assert.equal(qingtian.album, '叶惠美');
    assert.equal(qingtian.folder, '华语/周杰伦');

    const yequ = tracks.find((t) => t.path === '华语/周杰伦/夜曲.mp3');
    assert.equal(yequ.title, '夜曲'); // 无标签回退文件名
    assert.equal(yequ.artist, '');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('scanner: 目录不存在返回空数组', () => {
  assert.deepEqual(scanLibrary('/nonexistent/wmp-dir'), []);
});
