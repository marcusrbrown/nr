#!/usr/bin/env node
// Contact sheet of an atlas for review: colour above normal, selected frames, nearest-neighbour upscaled.
//
//   node tools/render/preview.mjs <atlas dir> <name> <out.png> [--frames 0,4,9] [--scale 3] [--bg 303844]
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { decodePng, encodePng } from './post.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const [dir, name, out] = argv;
if (!dir || !name || !out) { console.error('usage: preview.mjs <atlas dir> <name> <out.png> [--frames a,b] [--scale n] [--bg rrggbb]'); process.exit(2); }
const manifest = JSON.parse(readFileSync(join(resolve(dir), `${name}.json`), 'utf8'));
const scale = Number(opt('scale', 3));
const bg = Buffer.from(opt('bg', '303844'), 'hex');
const frames = (opt('frames') ?? manifest.frames.map((f) => f.index).join(',')).split(',').map(Number);
const { width: cw, height: ch } = manifest.cell;
const pages = manifest.pages.map((p) => ({ colour: decodePng(readFileSync(join(resolve(dir), p.colour.file))), normal: decodePng(readFileSync(join(resolve(dir), p.normal.file))) }));
const W = frames.length * cw * scale, H = 2 * ch * scale;
const img = new Uint8Array(W * H * 4);
for (let i = 0; i < W * H; i++) { img[i * 4] = bg[0]; img[i * 4 + 1] = bg[1]; img[i * 4 + 2] = bg[2]; img[i * 4 + 3] = 255; }
frames.forEach((fi, col) => {
  const f = manifest.frames[fi];
  ['colour', 'normal'].forEach((role, row) => {
    const src = pages[f.page][role];
    for (let y = 0; y < ch * scale; y++) for (let x = 0; x < cw * scale; x++) {
      const s = ((f.rect.y + Math.floor(y / scale)) * src.width + f.rect.x + Math.floor(x / scale)) * 4;
      if (src.data[s + 3] === 0) continue;
      const o = ((row * ch * scale + y) * W + col * cw * scale + x) * 4;
      img[o] = src.data[s]; img[o + 1] = src.data[s + 1]; img[o + 2] = src.data[s + 2]; img[o + 3] = 255;
    }
  });
});
writeFileSync(resolve(out), encodePng(W, H, img));
console.log(`${out}: ${frames.length} frames, ${W}x${H}`);
