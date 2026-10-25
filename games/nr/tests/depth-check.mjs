#!/usr/bin/env node
// No two faces of the street block tie in depth. Two faces that face the same way, lie in one plane (within EPS) and overlap
// in area are ordered by the host's depth tie-break, which differed between romdev GL and native on the sky's haze bands (8,037
// pixels at the top of the frame; docs/evidence/combat-slice/README.md, "Image tolerance calibration"). The check reads
// games/nr/assets/arena/layout.json (every box and plane the street block draws; decals do not write depth), builds the six
// faces of every box and the front face of every plane, and reports each coplanar overlapping same-facing pair. With --control it
// adds a pair that ties (the sky's haze bands at one depth, as before the fix) and must find it.
//
//   node games/nr/tests/depth-check.mjs [--eps 0.004] [--out <dir>] [--control]
//
// Exit status 1 when a tie is found (or, with --control, when the planted one is not). No GPU needed.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT } from './look-lib.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const EPS = +opt('eps', 0.004);
const OUT = resolve(ROOT, opt('out', 'out/round2/depth-check'));
const CONTROL = argv.includes('--control');
mkdirSync(OUT, { recursive: true });

const layout = JSON.parse(readFileSync(join(ROOT, 'games/nr/assets/arena/layout.json'), 'utf8'));
const solids = layout.solids.filter((s) => s.shape === 'box' || s.shape === 'plane').map((s) => ({ ...s }));
if (CONTROL) {
  const h = solids.filter((s) => s.id.startsWith('haze-'));
  const a = h.find((s) => s.id === 'haze-1'), b = h.find((s) => s.id === 'haze-2');
  solids.push({ ...b, id: 'haze-2-control', z: a.z }); // the second band at the first's depth, as it was
}

// a face: axis (0 x, 1 y, 2 z), direction (+1 / -1: the way it faces), position along the axis, and the ranges on the other two axes.
// Only faces the belt camera can see are kept: it looks down (-y faces never show) and along -z (-z faces never show), and the
// street's x ends, where the camera never looks, are out of range (the x faces beyond x -6 to 26).
const SEEN_X = [-6, 26];
function faces(s) {
  const c = [s.x, s.y, s.z], size = s.shape === 'plane' ? [s.w, s.h, 0] : [s.w, s.h, s.d];
  const out = [];
  for (const axis of s.shape === 'plane' ? [2] : [0, 1, 2]) {
    for (const dir of s.shape === 'plane' ? [1] : [-1, 1]) {
      const others = [0, 1, 2].filter((k) => k !== axis);
      if (dir < 0 && axis !== 0) continue;
      const at = c[axis] + dir * size[axis] / 2;
      if (axis === 0 && (at < SEEN_X[0] || at > SEEN_X[1])) continue;
      out.push({ id: s.id, axis, dir, at, r: others.map((k) => [c[k] - size[k] / 2, c[k] + size[k] / 2]) });
    }
  }
  return out;
}
const all = solids.flatMap(faces);
const overlap = (a, b) => Math.min(a[1], b[1]) - Math.max(a[0], b[0]);
const ties = [];
for (let i = 0; i < all.length; i++) {
  for (let j = i + 1; j < all.length; j++) {
    const a = all[i], b = all[j];
    if (a.id === b.id || a.axis !== b.axis || a.dir !== b.dir || Math.abs(a.at - b.at) > EPS) continue;
    const w = overlap(a.r[0], b.r[0]), h = overlap(a.r[1], b.r[1]);
    if (w > 1e-3 && h > 1e-3) ties.push({ a: a.id, b: b.id, axis: 'xyz'[a.axis], dir: a.dir, at: [a.at, b.at], area: +(w * h).toFixed(3) });
  }
}
// the closest the faces of overlapping same-facing pairs come without tying: reported so a margin is visible
let nearest = Infinity;
for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
  const a = all[i], b = all[j];
  if (a.id === b.id || a.axis !== b.axis || a.dir !== b.dir) continue;
  const d = Math.abs(a.at - b.at);
  if (d > EPS && d < nearest && overlap(a.r[0], b.r[0]) > 1e-3 && overlap(a.r[1], b.r[1]) > 1e-3) nearest = d;
}

const ok = CONTROL ? ties.some((t) => t.a.startsWith('haze') && t.b.startsWith('haze')) : ties.length === 0;
const text = `${ok ? 'PASS' : 'FAIL'} ${CONTROL ? 'control: the planted tie is found' : 'no two coplanar same-facing faces overlap'}: ${solids.length} boxes and planes, ${all.length} faces, eps ${EPS}; ${ties.length} tie(s)${ties.length ? `\n${ties.map((t) => `  ${t.a} / ${t.b}: ${t.axis}${t.dir > 0 ? '+' : '-'} at ${t.at.map((v) => v.toFixed(3)).join(' / ')}, area ${t.area}`).join('\n')}` : ''}\nnearest overlapping same-facing pair beyond eps: ${nearest === Infinity ? 'none' : nearest.toFixed(4)}\n`;
console.log(text.trimEnd());
writeFileSync(join(OUT, `depth-check${CONTROL ? '-control' : ''}.txt`), text);
writeFileSync(join(OUT, `depth-check${CONTROL ? '-control' : ''}.json`), `${JSON.stringify({ ok, eps: EPS, faces: all.length, ties, nearest }, null, 2)}\n`);
process.exit(ok ? 0 : 1);
