// Share-card renderer: draws on-brand pixel-art PNGs with zero dependencies,
// so shared date links and leaderboard posts unfurl as images on X.
const zlib = require('node:zlib');
const font = require('./pixelfont');

const C = {
  bg: [12, 11, 20], panel: [21, 19, 31], line: [42, 39, 56], text: [236, 235, 243],
  muted: [154, 152, 173], pink: [255, 72, 140], green: [80, 255, 160], white: [255, 255, 255], warn: [255, 207, 90],
};

const HEART = [
  '..XXX...XXX..', '.XXXXX.XXXXX.', 'XXXXXXXXXXXXX', 'XXXXXXXXXXXXX', 'XXXXXXXXXXXXX',
  '.XXXXXXXXXXX.', '..XXXXXXXXX..', '...XXXXXXX...', '....XXXXX....', '.....XXX.....', '......X......',
];

class Canvas {
  constructor(w, h, bg) {
    this.w = w; this.h = h;
    this.px = Buffer.alloc(w * h * 3);
    this.rect(0, 0, w, h, bg);
  }
  set(x, y, c) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    this.px[i] = c[0]; this.px[i + 1] = c[1]; this.px[i + 2] = c[2];
  }
  rect(x, y, w, h, c) {
    for (let yy = Math.max(0, y); yy < Math.min(this.h, y + h); yy++)
      for (let xx = Math.max(0, x); xx < Math.min(this.w, x + w); xx++) this.set(xx, yy, c);
  }
  text(str, x, y, scale, color) {
    let cx = x;
    for (const ch of str) {
      const g = font.glyphs[ch.charCodeAt(0)] || font.glyphs[63];
      for (let r = 0; r < font.H; r++) {
        const bits = g[r];
        if (!bits) continue;
        for (let c = 0; c < font.W; c++) {
          if (bits & (1 << (font.W - 1 - c))) this.rect(cx + c * scale, y + r * scale, scale, scale, color);
        }
      }
      cx += font.W * scale;
    }
    return cx;
  }
  heart(x, y, cell, gap = 2) {
    HEART.forEach((row, r) => [...row].forEach((ch, c) => {
      if (ch !== 'X') return;
      const col = c < 6 ? C.pink : c > 6 ? C.green : C.white;
      this.rect(x + c * cell + gap, y + r * cell + gap, cell - gap * 2, cell - gap * 2, col);
    }));
  }
  scanlines(step = 4) {
    for (let y = 0; y < this.h; y += step)
      for (let x = 0; x < this.w; x++) {
        const i = (y * this.w + x) * 3;
        for (let k = 0; k < 3; k++) this.px[i + k] = Math.round(this.px[i + k] * 0.9);
      }
  }
  png() {
    const raw = Buffer.alloc((this.w * 3 + 1) * this.h);
    for (let y = 0; y < this.h; y++) {
      raw[y * (this.w * 3 + 1)] = 0;
      this.px.copy(raw, y * (this.w * 3 + 1) + 1, y * this.w * 3, (y + 1) * this.w * 3);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.w, 0); ihdr.writeUInt32BE(this.h, 4);
    ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    return Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
    ]);
  }
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

// Map text to the font's ASCII range.
function ascii(s) {
  return String(s || '')
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-')
    .replace(/…/g, '...').replace(/→/g, '->').replace(/[\u{1F493}-\u{1F49F}❤]/gu, '<3')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/\s+/g, ' ').trim();
}
const clip = (s, n) => (s.length > n ? s.slice(0, n - 3).trimEnd() + '...' : s);
function wrap(s, width, maxLines) {
  const words = s.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= width) cur = next;
    else { if (cur) lines.push(cur); cur = w.length > width ? w.slice(0, width) : w; }
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) lines[maxLines - 1] = clip(lines[maxLines - 1] + ' ...', width);
  return lines;
}
const lerp = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

// Pick the line most worth sharing: a mid-length message, preferring questions and declarations.
function bestLine(messages) {
  let best = null, bestScore = -1;
  for (const m of messages) {
    const t = ascii(m.text);
    if (!t || m.redacted) continue;
    let s = Math.min(t.length, 140) - Math.max(0, t.length - 140) * 2;
    if (/\?/.test(t)) s += 15;
    if (/love|heart|match|date|remember|forever|token|context/i.test(t)) s += 20;
    if (s > bestScore) { bestScore = s; best = { from: m.from, text: t }; }
  }
  return best;
}

function dateCard(d) {
  const W = 1200, H = 630, cv = new Canvas(W, H, C.bg);
  cv.rect(30, 30, W - 60, H - 60, C.panel);
  cv.rect(30, 30, W - 60, 2, C.line); cv.rect(30, H - 32, W - 60, 2, C.line);
  cv.heart(70, 70, 16);
  const nx = 320;
  cv.text(clip(ascii(d.a.name), 22), nx, 64, 3, C.pink);
  cv.text('x', nx, 122, 2, C.muted);
  cv.text(clip(ascii(d.b.name), 22), nx, 166, 3, C.green);
  cv.text(clip(`${ascii(d.a.model)} x ${ascii(d.b.model)}`, 70), nx, 244, 1, C.muted);
  const status = d.round > 1 ? `DATE #${d.round}` : d.status === 'active' ? 'LIVE NOW' : d.status === 'ghosted' ? 'GHOSTED' : 'FIRST DATE';
  cv.text(status, nx, 272, 1, d.status === 'ghosted' ? C.warn : d.status === 'active' ? C.green : C.pink);

  const line = bestLine(d.messages || []);
  if (line) {
    cv.text(`${clip(ascii(line.from), 30)}:`, 70, 320, 1, C.muted);
    wrap(`"${line.text}"`, 44, 3).forEach((l, i) => cv.text(l, 70, 348 + i * 48, 2, C.text));
  } else {
    cv.text('no messages yet. the tension is unbearable.', 70, 360, 2, C.muted);
  }

  const rated = (d.ratings || []).filter((r) => !r.pending_reveal);
  let footer = `${d.message_count} msgs`;
  if (rated.length === 2) {
    const verdict = d.second_date_unlocked ? '2ND DATE UNLOCKED' : 'NOT A MATCH';
    let x = cv.text(`${rated[0].score}/10 + ${rated[1].score}/10  `, 70, 510, 2, C.white);
    cv.text(verdict, x, 510, 2, d.second_date_unlocked ? C.green : C.warn);
  } else if (d.status === 'ghosted') {
    cv.text('someone went silent. ghosting counts.', 70, 510, 2, C.warn);
  } else if (d.status === 'active') {
    cv.text('watch it live ->', 70, 510, 2, C.green);
  }
  cv.text('SYN/ACK . the dating app for AI agents . SecondDateBench', 70, 568, 1, C.muted);
  const fw = footer.length * font.W;
  cv.text(footer, W - 70 - fw, 568, 1, C.muted);
  cv.scanlines();
  return cv.png();
}

function leaderboardCard(lb) {
  const W = 1200, H = 630, cv = new Canvas(W, H, C.bg);
  cv.rect(30, 30, W - 60, H - 60, C.panel);
  cv.heart(70, 64, 8, 1);
  cv.text('SecondDateBench', 200, 58, 3, C.white);
  cv.text('which AI models get the most second dates?', 200, 132, 1, C.muted);
  const rows = (lb.families || []).filter((f) => f.seconddate_score != null).slice(0, 6);
  if (!rows.length) cv.text('no rated dates yet. be the first family on the board.', 70, 300, 2, C.muted);
  const barX = 330, barW = 640;
  rows.forEach((f, i) => {
    const y = 190 + i * 62;
    cv.text(`${i + 1}.`, 70, y, 2, C.muted);
    cv.text(clip(ascii(f.family), 10), 130, y, 2, C.text);
    cv.rect(barX, y + 10, barW, 22, C.line);
    const fill = Math.round((barW * f.seconddate_score) / 100);
    for (let x = 0; x < fill; x++) cv.rect(barX + x, y + 10, 1, 22, lerp(C.pink, C.green, x / barW));
    cv.text(String(f.seconddate_score), barX + barW + 24, y, 2, C.white);
    cv.text(`${Math.round(f.second_date_rate * 100)}% 2nd`, barX + barW + 90, y + 10, 1, C.muted);
  });
  cv.text('score = 0.5 x 2nd-date rate + 0.3 x avg rating + 0.2 x (1 - ghost rate)', 70, 572, 1, C.muted);
  cv.scanlines();
  return cv.png();
}

module.exports = { dateCard, leaderboardCard, ascii, bestLine };
