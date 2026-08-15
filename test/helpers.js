/**
 * 测试工具：构造带 ID3v2.3 标签的最小 mp3、构造 multipart 请求体、生成测试音频文件。
 */
import fs from 'node:fs';
import path from 'node:path';

/** 构造一个文本帧（ID3v2.3，编码 3=UTF-8） */
function textFrame(id, text) {
  const data = Buffer.concat([Buffer.from([3]), Buffer.from(text, 'utf-8')]);
  const head = Buffer.alloc(10);
  head.write(id, 0, 'latin1');
  head.writeUInt32BE(data.length, 4);
  head[8] = 0;
  head[9] = 0;
  return Buffer.concat([head, data]);
}

/** 构造带 ID3v2.3 标签的 mp3 Buffer（标签后附一段静音帧占位） */
export function buildTaggedMp3({ title, artist, album }) {
  const frames = Buffer.concat([
    title ? textFrame('TIT2', title) : Buffer.alloc(0),
    artist ? textFrame('TPE1', artist) : Buffer.alloc(0),
    album ? textFrame('TALB', album) : Buffer.alloc(0),
  ]);
  const header = Buffer.alloc(10);
  header.write('ID3', 0, 'latin1');
  header[3] = 3; // version 2.3
  header[4] = 0;
  header[5] = 0; // flags
  // synchsafe size
  const size = frames.length;
  header[6] = (size >> 21) & 0x7f;
  header[7] = (size >> 14) & 0x7f;
  header[8] = (size >> 7) & 0x7f;
  header[9] = size & 0x7f;
  // 一段伪音频数据
  const fakeAudio = Buffer.alloc(1024, 0);
  return Buffer.concat([header, frames, fakeAudio]);
}

/** 构造无标签的 mp3 Buffer */
export function buildPlainMp3(bytes = 512) {
  return Buffer.alloc(bytes, 1);
}

/** 构造 multipart/form-data 请求体 */
export function buildMultipart(boundary, { filename, data, fieldName = 'file' }) {
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return Buffer.concat([head, data, tail]);
}

/** 在目录中创建测试曲目 */
export function createTestLibrary(root) {
  fs.mkdirSync(path.join(root, '华语', '周杰伦'), { recursive: true });
  fs.mkdirSync(path.join(root, '欧美'), { recursive: true });
  fs.writeFileSync(path.join(root, '华语', '周杰伦', '晴天.mp3'), buildTaggedMp3({ title: '晴天', artist: '周杰伦', album: '叶惠美' }));
  fs.writeFileSync(path.join(root, '华语', '周杰伦', '夜曲.mp3'), buildPlainMp3());
  fs.writeFileSync(path.join(root, '欧美', 'song.ogg'), Buffer.alloc(256, 2));
  fs.writeFileSync(path.join(root, '欧美', 'track.FLAC'), Buffer.alloc(256, 3)); // 大写后缀
  fs.writeFileSync(path.join(root, '欧美', 'song.lrc'), '[00:01.00]hello\n[00:02.50]world\n');
  fs.writeFileSync(path.join(root, 'readme.txt'), 'not audio');
  fs.writeFileSync(path.join(root, '.hidden.mp3'), buildPlainMp3(64)); // 隐藏文件应被忽略
  fs.mkdirSync(path.join(root, '.hiddendir'), { recursive: true });
  fs.writeFileSync(path.join(root, '.hiddendir', 'x.mp3'), buildPlainMp3(64));
}
