/**
 * ID3v2 标签解析器（零依赖）
 * 支持 ID3v2.2 / v2.3 / v2.4，提取 TIT2(标题) / TPE1(艺术家) / TALB(专辑)。
 * v2.2 对应帧：TT2 / TP1 / TAL。
 */

/** 读取 synchsafe 整数（每字节只用 7 位） */
export function synchsafe(buf, offset = 0) {
  return (
    ((buf[offset] & 0x7f) << 21) |
    ((buf[offset + 1] & 0x7f) << 14) |
    ((buf[offset + 2] & 0x7f) << 7) |
    (buf[offset + 3] & 0x7f)
  );
}

/** 解码文本帧内容（首字节为编码类型） */
export function decodeTextFrame(data) {
  if (!data || data.length === 0) return '';
  const enc = data[0];
  const body = data.subarray(1);
  try {
    if (enc === 0) {
      return new TextDecoder('iso-8859-1').decode(body).replace(/\0+$/u, '');
    }
    if (enc === 1) {
      // UTF-16 with BOM
      return new TextDecoder('utf-16').decode(body).replace(/\0+$/u, '');
    }
    if (enc === 2) {
      // UTF-16BE 无 BOM：手动加 BOM
      const withBom = new Uint8Array(body.length + 2);
      withBom[0] = 0xfe;
      withBom[1] = 0xff;
      withBom.set(body, 2);
      return new TextDecoder('utf-16be').decode(withBom).replace(/\0+$/u, '');
    }
    if (enc === 3) {
      return new TextDecoder('utf-8').decode(body).replace(/\0+$/u, '');
    }
  } catch {
    /* 解码失败回退 */
  }
  return new TextDecoder('utf-8').decode(body).replace(/\0+$/u, '');
}

/**
 * 从完整文件 Buffer 解析 ID3v2 标签。
 * @param {Buffer} buf 文件内容（至少包含标签头）
 * @returns {{ title: string|null, artist: string|null, album: string|null }}
 */
export function parseId3v2(buf) {
  const result = { title: null, artist: null, album: null };
  if (!buf || buf.length < 10 || buf[0] !== 0x49 || buf[1] !== 0x44 || buf[2] !== 0x33) {
    return result; // 无 "ID3" 魔数
  }
  const major = buf[3];
  if (major < 2 || major > 4) return result;
  const tagSize = synchsafe(buf, 6);
  const end = Math.min(10 + tagSize, buf.length);
  let pos = 10;

  // v2.4 的帧大小是 synchsafe；v2.3 是普通大端整数；v2.2 帧头为 3+3 字节
  const frameIdLen = major === 2 ? 3 : 4;
  const frameSizeLen = major === 2 ? 3 : 4;
  const frameFlagsLen = major === 2 ? 0 : 2;

  const wanted =
    major === 2
      ? { TT2: 'title', TP1: 'artist', TAL: 'album' }
      : { TIT2: 'title', TPE1: 'artist', TALB: 'album' };

  while (pos + frameIdLen + frameSizeLen + frameFlagsLen <= end) {
    const idBytes = buf.subarray(pos, pos + frameIdLen);
    const id = idBytes.toString('latin1');
    // 填充或非法帧 ID：停止
    if (idBytes.every((b) => b === 0) || !/^[A-Z0-9]+$/u.test(id)) break;

    let size;
    if (frameSizeLen === 3) {
      size = (buf[pos + 3] << 16) | (buf[pos + 4] << 8) | buf[pos + 5];
    } else if (major === 4) {
      size = synchsafe(buf, pos + 4);
    } else {
      size = buf.readUInt32BE(pos + 4);
    }
    const dataStart = pos + frameIdLen + frameSizeLen + frameFlagsLen;
    if (size <= 0 || dataStart + size > end) break;

    const key = wanted[id];
    if (key && result[key] === null) {
      result[key] = decodeTextFrame(buf.subarray(dataStart, dataStart + size)).trim() || null;
    }
    pos = dataStart + size;
  }
  return result;
}
