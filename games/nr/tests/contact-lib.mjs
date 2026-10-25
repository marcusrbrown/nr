// Contact sheets of a character atlas: one row per clip, every frame cropped to the union of the clips' silhouettes,
// nearest-neighbour upscaled, the ground pivot in magenta. Shared by clips-check.mjs (hero) and enemies-check.mjs.
import { encodePng } from '../../../tools/render/post.mjs';

/** The opaque bounding box of the frame rect `r` of a decoded colour sheet. */
export const opaqueBox = (img, r) => {
  let x0 = r.w, x1 = -1, y0 = r.h, y1 = -1, n = 0;
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
    if (img.data[((r.y + y) * img.width + r.x + x) * 4 + 3] !== 255) continue;
    n++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return { x0, x1, y0, y1, n };
};

const FONT = {
  a: '010 101 111 101 101', b: '110 101 110 101 110', c: '011 100 100 100 011', d: '110 101 101 101 110', e: '111 100 110 100 111',
  f: '111 100 110 100 100', g: '011 100 101 101 011', h: '101 101 111 101 101', i: '111 010 010 010 111', j: '001 001 001 101 010',
  k: '101 101 110 101 101', l: '100 100 100 100 111', m: '101 111 111 101 101', n: '110 101 101 101 101', o: '010 101 101 101 010',
  p: '110 101 110 100 100', q: '010 101 101 111 011', r: '110 101 110 101 101', s: '011 100 010 001 110', t: '111 010 010 010 010',
  u: '101 101 101 101 111', v: '101 101 101 101 010', w: '101 101 111 111 101', x: '101 101 010 101 101', y: '101 101 010 010 010',
  z: '111 001 010 100 111', 0: '111 101 101 101 111', 1: '010 110 010 010 111', 2: '110 001 010 100 111', 3: '110 001 010 001 110',
  4: '101 101 111 001 001', 5: '111 100 110 001 110', 6: '011 100 111 101 111', 7: '111 001 010 010 010', 8: '111 101 111 101 111',
  9: '111 101 111 001 110', _: '000 000 000 000 111',
};
export const SCALE = 4;
const TEXT = 6, GAP = 4, MARGIN = 4;

/** `sheets[page].colour|normal` are decoded PNGs; `boxes[i]` is opaqueBox of frame i. */
export function contactSheet({ manifest, sheets, boxes }, role) {
  const { width: CW, height: CH } = manifest.cell;
  const u = { x0: CW, x1: 0, y0: CH, y1: 0 };
  for (const b of boxes) { u.x0 = Math.min(u.x0, b.x0); u.x1 = Math.max(u.x1, b.x1); u.y0 = Math.min(u.y0, b.y0); u.y1 = Math.max(u.y1, b.y1); }
  const cx0 = Math.max(0, u.x0 - MARGIN), cx1 = Math.min(CW - 1, u.x1 + MARGIN), cy0 = Math.max(0, u.y0 - MARGIN), cy1 = Math.min(CH - 1, u.y1 + MARGIN);
  const cw = cx1 - cx0 + 1, ch = cy1 - cy0 + 1;
  const tile = { w: cw * SCALE + GAP, h: ch * SCALE + GAP };
  const gutter = Math.max(...manifest.clips.map((c) => c.name.length)) * 4 * TEXT + 2 * TEXT;
  const cols = Math.max(...manifest.clips.map((c) => c.count));
  const W = gutter + cols * tile.w + GAP, H = manifest.clips.length * tile.h + GAP;
  const out = new Uint8Array(W * H * 4);
  const bg = role === 'colour' ? [0x60, 0x68, 0x78] : [0x20, 0x20, 0x28];
  for (let i = 0; i < W * H; i++) { out[i * 4] = bg[0]; out[i * 4 + 1] = bg[1]; out[i * 4 + 2] = bg[2]; out[i * 4 + 3] = 255; }
  const dot = (x, y, w, h, rgb) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const o = ((y + j) * W + x + i) * 4; out[o] = rgb[0]; out[o + 1] = rgb[1]; out[o + 2] = rgb[2]; } };
  manifest.clips.forEach((c, row) => {
    const y0 = GAP + row * tile.h;
    // label
    [...c.name].forEach((ch2, k) => {
      const glyph = FONT[ch2]?.split(' ');
      if (!glyph) return;
      glyph.forEach((bits, gy) => [...bits].forEach((bit, gx) => { if (bit === '1') dot(TEXT + (k * 4 + gx) * TEXT, y0 + (tile.h - 5 * TEXT) / 2 - GAP / 2 + gy * TEXT, TEXT, TEXT, [0xf0, 0xf0, 0xf0]); }));
    });
    for (let i = 0; i < c.count; i++) {
      const f = manifest.frames[c.first + i];
      const img = sheets[f.page][role];
      const x0 = gutter + GAP + i * tile.w;
      dot(x0 - 1, y0 - 1, cw * SCALE + 2, 1, [0x30, 0x34, 0x40]); dot(x0 - 1, y0 + ch * SCALE, cw * SCALE + 2, 1, [0x30, 0x34, 0x40]);
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
        const s = ((f.rect.y + cy0 + y) * img.width + f.rect.x + cx0 + x) * 4;
        if (sheets[f.page].colour.data[s + 3] !== 255) continue;
        dot(x0 + x * SCALE, y0 + y * SCALE, SCALE, SCALE, [img.data[s], img.data[s + 1], img.data[s + 2]]);
      }
      const px = Math.round(f.pivot.x) - cx0, py = Math.round(f.pivot.y) - cy0;
      dot(x0 + (px - 1) * SCALE, y0 + (py - 1) * SCALE, 3 * SCALE, 3 * SCALE, [0xff, 0x00, 0xff]);
    }
  });
  return { width: W, height: H, png: encodePng(W, H, out), cell: { x: cx0, y: cy0, w: cw, h: ch } };
}
