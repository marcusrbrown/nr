#!/usr/bin/env node
// Lit luminance of the heavy's silhouette bands (boots, legs, torso, head) against the street ring around the figure, from a look
// capture and its state: the heavy's texels are projected through the belt camera (look-lib.mjs) and read in the picture; the ring is
// the pixels 40 px out from the silhouette on four sides that are not on the silhouette. Luminance is Rec. 709 on the 8-bit values.
//
//   node games/nr/tests/heavy-contrast.mjs <capture.png> <capture.json>
//
// Prints one line: `street ring <L> boots <L> legs <L> torso <L> head <L>`. A band at or above the ring separates from the street.
import { readFileSync } from 'node:fs';
import { camera, project, loadAtlas, readImage, texelWorld, CAM } from './look-lib.mjs';
const [png, json] = process.argv.slice(2);
const st = JSON.parse(readFileSync(json, 'utf8')); const img = readImage(png);
const at = loadAtlas('heavy'); const i = st['nr.actor_kind'].findIndex((k, j) => k === 3 && st['nr.actor_present'][j]); const pos = st['nr.hero_pos']; const fr = st['nr.hero_frame'][i]; const f = at.manifest.frames[fr];
const face = st['nr.actor_facing'][i] < 0; const cam = camera(st['nr.cam_x']);
const lum = (x, y) => { const o = (y * img.w + x) * 4; return 0.2126 * img.rgba[o] + 0.7152 * img.rgba[o + 1] + 0.0722 * img.rgba[o + 2]; };
const mask = new Set(); const bands = { boots: [], legs: [], torso: [], head: [] };
for (let v = 0; v < f.rect.h; v++) for (let u = 0; u < f.rect.w; u++) {
  const o = ((f.rect.y + v) * at.colour.w + f.rect.x + u) * 4; if (at.colour.rgba[o + 3] !== 255) continue;
  const w = texelWorld(at, cam, { x: pos[i * 3], z: pos[i * 3 + 2] }, u, v, face);
  w[1] += st['nr.actor_y'][i]; const [sx, sy] = project(cam, w).map(Math.round);
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) mask.add((sy + dy) * 1920 + sx + dx);
  const h = (f.pivot.y - v) / 64; (h < 0.3 ? bands.boots : h < 1.0 ? bands.legs : h < 1.7 ? bands.torso : bands.head).push([sx, sy]);
}
const ring = []; for (const k of mask) { const y = Math.floor(k / 1920), x = k % 1920; for (const [dx, dy] of [[-40,0],[40,0],[0,-40],[0,40]]) { const nx = x + dx, ny = y + dy; if (nx>=0&&ny>=0&&nx<1920&&ny<1080&&!mask.has(ny*1920+nx)) ring.push(lum(nx,ny)); } }
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
console.log('street ring', mean(ring).toFixed(1), Object.entries(bands).map(([k, p]) => `${k} ${p.length ? mean(p.map(([x, y]) => lum(x, y))).toFixed(1) : '-'}`).join('  '));
