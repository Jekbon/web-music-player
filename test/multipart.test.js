import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getBoundary, parseMultipart } from '../lib/multipart.js';
import { buildMultipart } from './helpers.js';

test('multipart: 从 Content-Type 提取 boundary', () => {
  assert.equal(getBoundary('multipart/form-data; boundary=abc123'), 'abc123');
  assert.equal(getBoundary('multipart/form-data; boundary="quoted"'), 'quoted');
  assert.equal(getBoundary('application/json'), null);
  assert.equal(getBoundary(undefined), null);
});

test('multipart: 正确切分文件二进制内容', () => {
  const boundary = '----testboundary';
  const payload = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x01]); // 含二进制字节
  const body = buildMultipart(boundary, { filename: 'a.mp3', data: payload });
  const parts = parseMultipart(body, boundary);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].name, 'file');
  assert.equal(parts[0].filename, 'a.mp3');
  assert.ok(parts[0].data.equals(payload));
});

test('multipart: 多字段与多文件', () => {
  const boundary = 'xyz';
  const p1 = Buffer.from('hello');
  const p2 = Buffer.from('world!');
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="one.mp3"\r\n\r\n`),
    p1,
    Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="two.ogg"\r\n\r\n`),
    p2,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const parts = parseMultipart(body, boundary);
  assert.equal(parts.length, 2);
  assert.equal(parts[0].filename, 'one.mp3');
  assert.ok(parts[0].data.equals(p1));
  assert.equal(parts[1].filename, 'two.ogg');
  assert.ok(parts[1].data.equals(p2));
});

test('multipart: 空内容返回空数组', () => {
  assert.deepEqual(parseMultipart(Buffer.alloc(0), 'b'), []);
  assert.deepEqual(parseMultipart(Buffer.from('x'), null), []);
});
