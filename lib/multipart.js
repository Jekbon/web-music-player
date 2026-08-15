/**
 * multipart/form-data 解析器（零依赖）
 * 从请求体 Buffer 中切分出字段与文件，支持二进制内容。
 */

/**
 * 从 Content-Type 头提取 boundary。
 * @returns {string|null}
 */
export function getBoundary(contentType) {
  if (!contentType) return null;
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  return m ? (m[1] ?? m[2]).trim() : null;
}

/** 在 Buffer 中查找子 Buffer 的位置（从 from 开始） */
function indexOf(buf, needle, from = 0) {
  return buf.indexOf(needle, from);
}

/**
 * 解析 multipart 请求体。
 * @param {Buffer} body 完整请求体
 * @param {string} boundary multipart boundary（不含 -- 前缀）
 * @returns {Array<{name:string, filename:string|null, contentType:string|null, data:Buffer}>}
 */
export function parseMultipart(body, boundary) {
  const parts = [];
  if (!body || !boundary) return parts;

  const delim = Buffer.from(`--${boundary}`);
  const crlf = Buffer.from('\r\n');
  const doubleCrlf = Buffer.from('\r\n\r\n');

  let pos = indexOf(body, delim, 0);
  if (pos === -1) return parts;

  while (true) {
    // 跳过 delimiter 与其后的 \r\n
    let partStart = pos + delim.length;
    // 结束标记 --boundary--
    if (body.subarray(partStart, partStart + 2).toString('latin1') === '--') break;
    if (body.subarray(partStart, partStart + 2).equals(crlf)) partStart += 2;

    // 头部结束位置
    const headerEnd = indexOf(body, doubleCrlf, partStart);
    if (headerEnd === -1) break;
    const headerText = body.subarray(partStart, headerEnd).toString('utf-8');
    const dataStart = headerEnd + doubleCrlf.length;

    // 下一段 delimiter（其前有 \r\n）
    const nextDelim = indexOf(body, Buffer.concat([crlf, delim]), dataStart);
    if (nextDelim === -1) break;
    const data = body.subarray(dataStart, nextDelim);

    // 解析头部
    let name = null;
    let filename = null;
    let contentType = null;
    for (const h of headerText.split('\r\n')) {
      const lower = h.toLowerCase();
      if (lower.startsWith('content-disposition:')) {
        const nm = /name="([^"]*)"/i.exec(h);
        if (nm) name = nm[1];
        const fn = /filename="([^"]*)"/i.exec(h);
        if (fn) filename = fn[1];
      } else if (lower.startsWith('content-type:')) {
        contentType = h.slice(h.indexOf(':') + 1).trim();
      }
    }

    parts.push({
      name: name ?? '',
      filename,
      contentType,
      data: Buffer.from(data),
    });

    pos = nextDelim + crlf.length; // 指向 --boundary
    if (body.subarray(pos + delim.length, pos + delim.length + 2).toString('latin1') === '--') break;
  }

  return parts;
}
