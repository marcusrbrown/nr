// Generates the spike's placeholder assets deterministically:
//   assets/sprites/{blue,orange}-{left,right}.png   32x48 RGBA actor sprites (two colours, two facings)
//   assets/audio/blip.wav                           16-bit mono 22050 Hz sine blip
// PNGs use stored (uncompressed) deflate blocks and the wav is integer PCM, so the bytes depend only on this
// script. Run from anywhere: node games/spike/tools/gen-placeholders.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const adler32 = (buf) => {
  let a = 1, b = 0;
  for (const x of buf) { a = (a + x) % 65521; b = (b + a) % 65521; }
  return ((b << 16) | a) >>> 0;
};
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  return Buffer.concat([u32(data.length), body, u32(crc32(body))]);
};

/** zlib stream made of stored blocks: no compressor, so no library-version dependence */
function zlibStored(raw) {
  const parts = [Buffer.from([0x78, 0x01])];
  for (let o = 0; o < raw.length || o === 0; o += 65535) {
    const n = Math.min(65535, raw.length - o);
    const last = o + n >= raw.length ? 1 : 0;
    const h = Buffer.alloc(5);
    h[0] = last;
    h.writeUInt16LE(n, 1);
    h.writeUInt16LE(~n & 0xffff, 3);
    parts.push(h, raw.subarray(o, o + n));
    if (last) break;
  }
  parts.push(u32(adler32(raw)));
  return Buffer.concat(parts);
}

function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.concat([u32(w), u32(h), Buffer.from([8, 6, 0, 0, 0])]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlibStored(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const W = 32, H = 48, R = 6;
const PALETTE = {
  blue: { body: [48, 120, 255], head: [96, 160, 255], edge: [16, 48, 120], nose: [215, 235, 255] },
  orange: { body: [255, 140, 40], head: [255, 176, 96], edge: [120, 56, 8], nose: [255, 236, 200] },
};

/** rounded rectangle membership; edge = inside the outer shape but not the inner one */
function inRound(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = x < x0 + r ? x0 + r : x > x1 - r ? x1 - r : x;
  const cy = y < y0 + r ? y0 + r : y > y1 - r ? y1 - r : y;
  return (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r;
}

function sprite(colour, facing) {
  const p = PALETTE[colour];
  const px = Buffer.alloc(W * H * 4); // zeros: alpha 0
  const put = (x, y, c) => { const o = (y * W + x) * 4; px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255; };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!inRound(x, y, 2, 2, W - 3, H - 3, R)) continue;
      const inner = inRound(x, y, 4, 4, W - 5, H - 5, R - 2);
      put(x, y, !inner ? p.edge : y < 16 ? p.head : p.body);
    }
  }
  // nose and eye on the facing side of the head
  const nx = facing === 'right' ? W - 10 : 5;
  for (let y = 8; y < 14; y++) for (let x = nx; x < nx + 5; x++) put(x, y, p.nose);
  const ex = facing === 'right' ? W - 15 : 12;
  for (let y = 7; y < 10; y++) for (let x = ex; x < ex + 3; x++) put(x, y, p.edge);
  return png(W, H, px);
}

function wav() {
  const rate = 22050, n = Math.round(rate * 0.12), freq = 880;
  const pcm = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const env = 1 - i / n;
    pcm.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * env * 0.5 * 32767), i * 2);
  }
  const hdr = Buffer.alloc(44);
  hdr.write('RIFF', 0, 'latin1'); hdr.writeUInt32LE(36 + pcm.length, 4); hdr.write('WAVE', 8, 'latin1');
  hdr.write('fmt ', 12, 'latin1'); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(1, 22);
  hdr.writeUInt32LE(rate, 24); hdr.writeUInt32LE(rate * 2, 28); hdr.writeUInt16LE(2, 32); hdr.writeUInt16LE(16, 34);
  hdr.write('data', 36, 'latin1'); hdr.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([hdr, pcm]);
}

mkdirSync(join(ASSETS, 'sprites'), { recursive: true });
mkdirSync(join(ASSETS, 'audio'), { recursive: true });
for (const c of Object.keys(PALETTE)) for (const f of ['left', 'right'])
  writeFileSync(join(ASSETS, 'sprites', `${c}-${f}.png`), sprite(c, f));
writeFileSync(join(ASSETS, 'audio', 'blip.wav'), wav());
console.log('placeholders written to', ASSETS);
