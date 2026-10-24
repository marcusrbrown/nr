// Generates the lit-sprite spike's placeholder assets deterministically:
//   assets/sprites/figure.png     64x128 RGBA albedo: a capsule body and a spherical head, alpha 0/255, no baked lighting
//   assets/sprites/figure-n.png   64x128 RGBA tangent-space normal map of the same figure (+X right, +Y up the image,
//                                 +Z out of the plane; the OpenGL convention three.js reads), (128,128,255) outside it
// PNGs use stored (uncompressed) deflate blocks, so the bytes depend only on this script.
//   node games/litspike/tools/gen-lit-placeholders.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'sprites');

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

const W = 64, H = 128;
const CX = 32;
// Shapes as height fields: a point at distance d from a shape's core (a segment) with radius r has height
// sqrt(r^2 - d^2); the shape with the greater height at a texel owns it. Image y grows down; the normal's y is up.
const SHAPES = [
  { name: 'head', ax: CX, ay0: 22, ay1: 22, r: 18 },
  { name: 'body', ax: CX, ay0: 54, ay1: 100, r: 24 },
];

function sample(x, y) {
  const px = x + 0.5, py = y + 0.5;
  let best = null;
  for (const s of SHAPES) {
    const cy = Math.min(Math.max(py, s.ay0), s.ay1);
    const dx = px - s.ax, dy = py - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 > s.r * s.r) continue;
    const h = Math.sqrt(s.r * s.r - d2);
    if (!best || h > best.h) best = { s, dx, dy, h };
  }
  return best;
}

const albedo = Buffer.alloc(W * H * 4);
const normal = Buffer.alloc(W * H * 4);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4;
    const hit = sample(x, y);
    if (!hit) {
      normal.set([128, 128, 255, 255], o); // flat, facing the camera
      continue;
    }
    const { s, dx, dy, h } = hit;
    // normal of the dome: the offset from the core, y flipped to up, and the height
    const len = Math.hypot(dx, dy, h) || 1;
    const n = [dx / len, -dy / len, h / len];
    normal.set(n.map((v) => Math.round((v * 0.5 + 0.5) * 255)).concat([255]), o);

    // flat albedo with a few details so the colour map is visible apart from the lighting
    let c = [208, 204, 198];
    if (s.name === 'head' && y >= 17 && y < 27 && Math.abs(x - CX) < 14) c = [44, 48, 64]; // visor
    if (s.name === 'body' && y >= 70 && y < 78) c = [70, 60, 56]; // belt
    if (s.name === 'body' && y >= 56 && y < 60 && Math.abs(x - CX) < 6) c = [196, 160, 60]; // buckle plate
    albedo.set([...c, 255], o);
  }
}

mkdirSync(ASSETS, { recursive: true });
writeFileSync(join(ASSETS, 'figure.png'), png(W, H, albedo));
writeFileSync(join(ASSETS, 'figure-n.png'), png(W, H, normal));
console.log('lit placeholders written to', ASSETS);
