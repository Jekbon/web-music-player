import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseId3v2 } from '../lib/id3.js';
import { buildTaggedMp3, buildPlainMp3 } from './helpers.js';

test('ID3: 从带标签 mp3 提取 TIT2/TPE1/TALB', () => {
  const buf = buildTaggedMp3({ title: '晴天', artist: '周杰伦', album: '叶惠美' });
  const tags = parseId3v2(buf);
  assert.equal(tags.title, '晴天');
  assert.equal(tags.artist, '周杰伦');
  assert.equal(tags.album, '叶惠美');
});

test('ID3: 部分标签缺失时其余为 null', () => {
  const buf = buildTaggedMp3({ title: '只有标题' });
  const tags = parseId3v2(buf);
  assert.equal(tags.title, '只有标题');
  assert.equal(tags.artist, null);
  assert.equal(tags.album, null);
});

test('ID3: 无标签返回全 null', () => {
  const tags = parseId3v2(buildPlainMp3());
  assert.deepEqual(tags, { title: null, artist: null, album: null });
});

test('ID3: 空或非 ID3 数据不抛错', () => {
  assert.deepEqual(parseId3v2(Buffer.alloc(0)), { title: null, artist: null, album: null });
  assert.deepEqual(parseId3v2(null), { title: null, artist: null, album: null });
  assert.deepEqual(parseId3v2(Buffer.from('not an id3 file')), { title: null, artist: null, album: null });
});
