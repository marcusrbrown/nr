// Luminance of the front grunt's silhouette in the lit build against the flat-normals build of the same scene (both at
// tick 1600 of input-waves.json), by distance from the silhouette's edge in screen pixels (one scene pixel is 3).
// The silhouette is the pixels the front actor changes when it is hidden (hide8 against hideboth).
import { readFileSync, writeFileSync } from 'node:fs';
import { decodePng } from '../../../../../tools/render/post.mjs';
const dir = new URL('../../../../../out/unit7/', import.meta.url).pathname;
const L = (f) => decodePng(readFileSync(`${dir}${f}-f1600.png`));
const base = L('base'), flat = L('flat'), h8 = L('hide8'), hb = L('hideboth');
const { width: W, height: H } = base;
const lum = (im, i) => 0.2126 * im.data[i * 4] + 0.7152 * im.data[i * 4 + 1] + 0.0722 * im.data[i * 4 + 2];
const inSil = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) inSil[i] = [0, 1, 2].some((k) => h8.data[i * 4 + k] !== hb.data[i * 4 + k]) ? 1 : 0;
// distance to the nearest non-silhouette pixel (4-neighbour BFS)
const dist = new Int16Array(W * H).fill(-1), q = [];
for (let i = 0; i < W * H; i++) if (!inSil[i]) { dist[i] = 0; q.push(i); }
for (let h = 0; h < q.length; h++) {
  const i = q[h], x = i % W, y = (i / W) | 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
    const n = ny * W + nx; if (dist[n] < 0) { dist[n] = dist[i] + 1; q.push(n); }
  }
}
const buckets = {};
for (let i = 0; i < W * H; i++) {
  if (!inSil[i]) continue;
  const b = Math.min(dist[i], 30), k = Math.floor((b - 1) / 3) * 3 + 1; // 1-3, 4-6, ...
  (buckets[k] ??= { n: 0, lit: 0, flat: 0 }); buckets[k].n++; buckets[k].lit += lum(base, i); buckets[k].flat += lum(flat, i);
}
const rows = Object.entries(buckets).map(([k, v]) => ({ edgeDistancePx: `${k}-${+k + 2}`, pixels: v.n, litLuma: +(v.lit / v.n).toFixed(1), flatLuma: +(v.flat / v.n).toFixed(1), ratio: +(v.lit / v.flat).toFixed(3) }));
console.table(rows);
writeFileSync(new URL('rim.json', import.meta.url), `${JSON.stringify(rows, null, 2)}\n`);
