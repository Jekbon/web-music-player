import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLrc } from '../lib/lrc.js';

test('LRC: 解析 [mm:ss.xx] 时间戳与文本', () => {
  const { lines } = parseLrc('[00:12.34]第一句\n[01:05.00]第二句');
  assert.equal(lines.length, 2);
  assert.ok(Math.abs(lines[0].time - 12.34) < 1e-6);
  assert.equal(lines[0].text, '第一句');
  assert.ok(Math.abs(lines[1].time - 65) < 1e-6);
  assert.equal(lines[1].text, '第二句');
});

test('LRC: 支持 [mm:ss.xxx] 毫秒时间戳', () => {
  const { lines } = parseLrc('[00:01.500]毫秒行');
  assert.ok(Math.abs(lines[0].time - 1.5) < 1e-6);
});

test('LRC: 一行多时间戳展开为多条', () => {
  const { lines } = parseLrc('[00:10.00][00:20.00]重复的一句');
  assert.equal(lines.length, 2);
  assert.ok(Math.abs(lines[0].time - 10) < 1e-6);
  assert.ok(Math.abs(lines[1].time - 20) < 1e-6);
  assert.equal(lines[0].text, '重复的一句');
  assert.equal(lines[1].text, '重复的一句');
});

test('LRC: 忽略元数据标签与畸形行', () => {
  const { lines } = parseLrc('[ti:歌名]\n[ar:歌手]\n[by:制作]\n没有时间戳的行\n[00:03.00]有效行');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, '有效行');
});

test('LRC: 按时间升序排序', () => {
  const { lines } = parseLrc('[00:30.00]后\n[00:05.00]前');
  assert.equal(lines[0].text, '前');
  assert.equal(lines[1].text, '后');
});

test('LRC: offset 正值整体提前', () => {
  const { lines } = parseLrc('[offset:500]\n[00:10.00]偏移行');
  assert.ok(Math.abs(lines[0].time - 9.5) < 1e-6);
});

test('LRC: 空文本返回空数组', () => {
  assert.deepEqual(parseLrc('').lines, []);
  assert.deepEqual(parseLrc(null).lines, []);
});
