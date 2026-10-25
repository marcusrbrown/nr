#!/usr/bin/env node
// The camera's silhouette allowance against the atlases: the widest a frame of a character reaches from its pivot, along x,
// over every clip and both facings (a plane facing left is the frame mirrored about the pivot, so its reach to the left is the
// frame's reach to the right and the reverse). main.c's CAMERA_ALLOWANCE is what the leash keeps between a player and the
// edge of the frame (nr_sim_view_half), so it must hold the widest hero frame and should not hold much more.
//
//   node games/nr/tests/reach-check.mjs [--out <dir>]
//
//   <out>/reach-check.txt / .json   PASS / FAIL lines, the per-clip reach table of the three characters and the frame widths
// Exit status 1 when a check fails. No Blender, GPU or network needed.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CAM, ROOT, loadAtlas } from './look-lib.mjs';

const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const OUT = resolve(opt('out') ?? join(ROOT, 'out/round2/reach-check'));
mkdirSync(OUT, { recursive: true });

const mainC = readFileSync(join(ROOT, 'games/nr/main.c'), 'utf8');
const ALLOWANCE = +mainC.match(/#define CAMERA_ALLOWANCE ([0-9.]+)f/)[1];
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`); };

/** per clip: the widest reach of any frame to the right and to the left of the pivot, in world units, and the frame it is at */
function reach(name) {
  const a = loadAtlas(name), { manifest: m } = a, out = [];
  for (const c of m.clips) {
    const r = { clip: c.name, right: 0, rightFrame: -1, left: 0, leftFrame: -1 };
    for (let k = 0; k < c.count; k++) {
      const f = m.frames[c.first + k];
      let lo = Infinity, hi = -Infinity;
      for (let v = 0; v < f.rect.h; v++) for (let u = 0; u < f.rect.w; u++) {
        if (a.colour.rgba[((f.rect.y + v) * a.colour.w + f.rect.x + u) * 4 + 3] !== 255) continue;
        lo = Math.min(lo, u); hi = Math.max(hi, u);
      }
      const right = (hi + 1 - f.pivot.x) / CAM.ppu, left = (f.pivot.x - lo) / CAM.ppu;
      if (right > r.right) { r.right = right; r.rightFrame = k; }
      if (left > r.left) { r.left = left; r.leftFrame = k; }
    }
    out.push(r);
  }
  return out;
}
const widest = (rows) => rows.reduce((w, r) => (Math.max(r.right, r.left) > w.reach ? { clip: r.clip, reach: Math.max(r.right, r.left), side: r.right >= r.left ? 'right' : 'left', frame: r.right >= r.left ? r.rightFrame : r.leftFrame } : w), { reach: 0 });

const tables = Object.fromEntries(['hero', 'grunt', 'heavy'].map((n) => [n, reach(n)]));
const w = Object.fromEntries(Object.entries(tables).map(([n, rows]) => [n, widest(rows)]));
for (const [n, x] of Object.entries(w)) console.log(`     ${n}: widest ${x.reach.toFixed(3)} units (${x.clip}, frame ${x.frame}, ${x.side})`);

check('the allowance holds the hero\'s widest frame, both facings', ALLOWANCE >= w.hero.reach, `CAMERA_ALLOWANCE ${ALLOWANCE} against ${w.hero.reach.toFixed(3)} (${w.hero.clip} frame ${w.hero.frame}, ${w.hero.side})`);
check('the allowance is not more than 0.05 above it', ALLOWANCE - w.hero.reach <= 0.05, `${(ALLOWANCE - w.hero.reach).toFixed(3)} over`);
const locomotion = ['idle', 'walk', 'run'].map((n) => tables.hero.find((r) => r.clip === n)).map((r) => Math.max(r.right, r.left));
check('a walking, running or idle hero at the edge is whole in the frame', locomotion.every((x) => x <= ALLOWANCE), `idle ${locomotion[0].toFixed(2)}, walk ${locomotion[1].toFixed(2)}, run ${locomotion[2].toFixed(2)} against ${ALLOWANCE}`);

// the frame's width at the lanes of the arena and what the allowance leaves of it (the same arithmetic as nr_sim_view_half)
const dist = (CAM.sceneH / CAM.ppu) / (2 * Math.tan((CAM.fovDeg * Math.PI) / 360)), cosP = Math.cos((CAM.pitchDeg * Math.PI) / 180);
const half = (lane) => (CAM.sceneW / CAM.ppu / 2) * (dist - lane * cosP) / dist;
const lanes = [-1.6, 0, 1.8].map((lane) => ({ lane, frameHalf: half(lane), leash: half(lane) - ALLOWANCE }));
const softWall = half(0.6) + half(-0.6) - 2 * ALLOWANCE;
for (const l of lanes) console.log(`     lane ${l.lane}: the frame is ${l.frameHalf.toFixed(2)} units each side of the camera, the leash ${l.leash.toFixed(2)}`);
check('the leash leaves play room: the leader\'s soft wall is more than 6 units ahead of the trailing player', softWall > 6, `${softWall.toFixed(2)} units at lanes 0.6 and -0.6 (a screen is ${(2 * half(0)).toFixed(2)} wide at the centre lane)`);

writeFileSync(join(OUT, 'reach-check.json'), `${JSON.stringify({ allowance: ALLOWANCE, widest: w, lanes, softWall, tables, results }, null, 2)}\n`);
writeFileSync(join(OUT, 'reach-check.txt'), `${results.map((r) => `${r.ok ? 'PASS' : 'FAIL'} ${r.name}: ${r.detail}`).join('\n')}\n\n${Object.entries(tables).map(([n, rows]) => `${n}\n${rows.map((r) => `  ${r.clip.padEnd(18)} right ${r.right.toFixed(2)} (frame ${r.rightFrame})  left ${r.left.toFixed(2)} (frame ${r.leftFrame})`).join('\n')}`).join('\n')}\n`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
