/**
 * LRC 歌词解析器（零依赖）
 * 支持 [mm:ss.xx] / [mm:ss.xxx] 时间戳、一行多时间戳展开、元数据标签与 offset 偏移。
 */

const TIME_TAG_RE = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/gu;
const META_TAG_RE = /^\[(ti|ar|al|by|offset|length|re|ve)\s*:.*\]$/iu;

/**
 * 解析 LRC 文本。
 * @param {string} text LRC 原文
 * @returns {{ lines: Array<{time:number,text:string}>, offset: number }}
 *   lines 按 time 升序；time 单位为秒（已应用 offset）。
 */
export function parseLrc(text) {
  if (typeof text !== 'string' || text.trim() === '') return { lines: [], offset: 0 };

  let offset = 0;
  const lines = [];

  for (const rawLine of text.split(/\r\n|\r|\n/u)) {
    const line = rawLine.trim();
    if (!line) continue;

    // 元数据标签行（如 [offset:+500]）
    if (META_TAG_RE.test(line)) {
      const m = /^\[offset\s*:\s*([+-]?\d+(?:\.\d+)?)\s*\]$/iu.exec(line);
      if (m) offset = parseFloat(m[1]);
      continue;
    }

    // 收集本行所有时间戳
    const times = [];
    let lastEnd = 0;
    TIME_TAG_RE.lastIndex = 0;
    let m;
    while ((m = TIME_TAG_RE.exec(line)) !== null) {
      const min = parseInt(m[1], 10);
      const sec = parseInt(m[2], 10);
      const fracRaw = m[3] ?? '0';
      // 两位小数 = 百分秒，三位 = 毫秒
      const frac = parseInt(fracRaw, 10) / 10 ** fracRaw.length;
      times.push(min * 60 + sec + frac);
      lastEnd = m.index + m[0].length;
    }
    if (times.length === 0) continue; // 无时间戳的行忽略

    const lyricText = line.slice(lastEnd).trim();
    for (const t of times) {
      lines.push({ time: t, text: lyricText });
    }
  }

  // offset：LRC 规范中正值表示整体提前（标签时间比实际快），即显示时间 = 标签时间 - offset/1000
  const offsetSec = offset / 1000;
  for (const l of lines) {
    l.time = Math.max(0, l.time - offsetSec);
  }
  lines.sort((a, b) => a.time - b.time);
  return { lines, offset };
}
