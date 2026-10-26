#!/usr/bin/env node
// The knockback special's shockwave (games/nr/main.c, "the knockback special's shockwave"): its curve, its determinism and its ordering on the
// ground, on the native binary on WebGPU (Dawn on Metal, SDL's offscreen driver) with the control build that has no ring.
//
//   CW_TEST_GPU=desktop node games/nr/tests/fx-check.mjs [--out out/round4/fx] [--publish docs/evidence/combat-slice/round4] [--no-build] [--control]
//
// 1. Curve: nr_look on input-look.json, one run per tick around the radius special (it enters on tick 110 and hits on tick 12 of the state):
//    the published radius, colour scale and flash equal what fx-lib.mjs computes from the state tick; the radius reaches the hit radius on the
//    last active tick and never passes it; the scale and the flash only fall after the hit; everything is 0 before the hit and after the fade.
// 2. Determinism: the same tick run twice gives the same picture and the same state (no random draw, no clock).
// 3. Ordering, on three captures (player 1 mid-expansion and fading, player 2 mid-expansion), each against the same tick of the control build
//    (`-DNR_NO_FX_RING=ON`: the ring and disc are not built, the flash light is): the pictures differ only inside the ring's outline
//    on the street (outside it, in the flash's light and everywhere else, they are equal); inside it they differ on the street; they do not differ
//    on any interior texel of an actor standing in the ring (the ring is under the feet, and under the part of the plane below the pivot);
//    they do not differ on the sidewalk the ring's outline crosses (player 2's ring reaches past the curb); and the ring's samples carry the
//    player's colour.
// --control runs the ordering captures with a ring built to draw after the actors (`-DCMAKE_C_FLAGS=-DFX_ORDER=1`: render order 1, still no
// depth write) against the no-ring build, and exits 0 only when the check rejects it (actor texels below the pivot differ).
// Exit status 1 on any failed assertion. The summary is written to <out>/fx-check.json and .txt.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FIELDS, ROOT } from './brawler.mjs';
import { camera, loadAtlas, project, readImage, texelWorld } from './look-lib.mjs';
import { fxAt, fxConstants, ringOnScreen, specialDef } from './fx-lib.mjs';
import { nativeWgpu } from './capture-lib.mjs';

void FIELDS;
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const CONTROL = argv.includes('--control');
const OUT = resolve(ROOT, opt('out', CONTROL ? 'out/round4/fx-control' : 'out/round4/fx'));
const PUBLISH = opt('publish') ? resolve(ROOT, opt('publish')) : null;
mkdirSync(OUT, { recursive: true });
const T = 'games/nr/tests/';
const LOOK = `${T}input-look.json`, P2 = `${T}input-fx-p2.json`;
const C = fxConstants(), D = specialDef();
const lines = [], failures = [];
const say = (s) => { lines.push(s); console.log(s); };
const check = (ok, what) => { if (!ok) failures.push(what); say(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const inputDir = join(OUT, 'input');
const run = (app, base, tick, input, exe = null) => {
  const r = nativeWgpu(app, base, tick, { input, inputDir, exe });
  if (r.status !== 0) throw new Error(`${app} tick ${tick}: ${r.status} ${(r.stderr || '').slice(-300)}`);
  return { st: readJson(`${base}.json`), png: `${base}.png` };
};

// ── 1. the curve ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const ENTER = 110; // the tick player 1 enters special_knockback on input-look.json (state tick 0)
const ticks = [ENTER + D.startup - 1, ...Array.from({ length: 6 }, (_, i) => ENTER + D.startup + i), ENTER + D.startup + 8, ENTER + D.startup + 12, ENTER + D.startup + 18,
  ENTER + D.startup + C.FX_TICKS - 1, ENTER + D.startup + C.FX_TICKS];
const curve = [];
for (const tick of CONTROL ? [] : ticks) {
  const { st } = run('nr_look', join(OUT, `curve-${tick}`), tick, LOOK);
  const t = st['nr.actor_state'][0] === 14 ? st['nr.actor_state_tick'][0] : -1, want = t < 0 ? { radius: 0, scale: 0, flash: 0 } : fxAt(t);
  const near = (a, b) => Math.abs(a - b) <= 1e-5 * Math.max(1, Math.abs(b));
  curve.push({ tick, stateTick: t, radius: st['nr.fx_radius'][0], scale: st['nr.fx_alpha'][0], flash: st['nr.fx_flash'], flashPlayer: st['nr.fx_flash_player'], other: st['nr.fx_radius'][1] });
  check(near(st['nr.fx_radius'][0], want.radius) && near(st['nr.fx_alpha'][0], want.scale) && near(st['nr.fx_flash'], want.flash) && st['nr.fx_radius'][1] === 0,
    `tick ${tick} (state tick ${t}): radius ${st['nr.fx_radius'][0].toFixed(4)}, colour scale ${st['nr.fx_alpha'][0].toFixed(4)}, flash ${st['nr.fx_flash'].toFixed(3)} equal the computed ${want.radius.toFixed(4)}, ${want.scale.toFixed(4)}, ${want.flash.toFixed(3)}`);
  check(st['cw.three.missing'] === 0, `tick ${tick}: cw.three.missing 0`);
}
const at = (t) => curve.find((c) => c.stateTick === t);
if (!CONTROL) {
check(curve[0].radius === 0 && curve[0].scale === 0 && curve[0].flash === 0, 'before the hit tick (state tick 11) there is no ring and no flash');
check(at(D.startup + D.active - 1).radius === Math.fround(D.radius), `the radius is the hit radius ${D.radius} on the last active tick (state tick ${D.startup + D.active - 1})`);
const grow = curve.filter((c) => c.stateTick >= D.startup && c.stateTick < D.startup + D.active);
check(grow.every((c, i) => i === 0 || c.radius > grow[i - 1].radius) && grow.every((c) => c.radius <= Math.fround(D.radius)), 'the radius grows on every active tick and never passes the hit radius');
const fade = curve.filter((c) => c.stateTick >= D.startup && c.scale > 0);
check(fade.every((c, i) => i === 0 || (c.scale < fade[i - 1].scale && c.flash <= fade[i - 1].flash)) && fade[0].scale === 1, 'the colour scale starts at 1 on the hit tick and only falls; the flash only falls');
const last = curve[curve.length - 1], lastIn = curve[curve.length - 2];
check(lastIn.scale > 0 && lastIn.scale < 0.01 && last.radius === 0 && last.scale === 0, `the ring is almost gone on its last tick (scale ${lastIn.scale.toFixed(4)}) and off after it`);
check(curve.every((c) => (c.flash > 0 ? c.flashPlayer === 0 : c.flashPlayer === -1)), 'the flash is at player 1 while it is on, and at nobody otherwise');

// ── 2. determinism ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const A = run('nr_look', join(OUT, 'det-a'), 125, LOOK), B = run('nr_look', join(OUT, 'det-b'), 125, LOOK);
check(Buffer.compare(readFileSync(A.png), readFileSync(B.png)) === 0 && JSON.stringify(A.st['nr.fx_radius']) === JSON.stringify(B.st['nr.fx_radius']) && A.st['nr.checksum'] === B.st['nr.checksum'],
  'the same tick run twice: byte-identical picture, same ring, same checksum');
}

// ── 3. ordering against the control build ─────────────────────────────────────────────────────────────────────────────────────────────
const variant = (dir, ...defs) => {
  if (argv.includes('--no-build')) return;
  const b = spawnSync('bash', ['games/nr/tests/build-variant.sh', dir, 'native', ...defs], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, NINJA_TARGETS: 'nr_look' } });
  if (b.status !== 0) { console.error((b.stderr || b.stdout).slice(-1200)); process.exit(1); }
};
variant('out/round4/build-noring', '-DNR_NO_FX_RING=ON');
const CTRL_EXE = join(ROOT, 'out/round4/build-noring/native/games/nr/nr_look');
let RING_EXE = null; // the ring-on binary: the normal build, or with --control the one whose ring is drawn after the actors
if (CONTROL) {
  variant('out/round4/build-order', '-DCMAKE_C_FLAGS=-DFX_ORDER=1');
  RING_EXE = join(ROOT, 'out/round4/build-order/native/games/nr/nr_look');
}
const ATLAS = { hero: loadAtlas('hero'), grunt: loadAtlas('grunt'), heavy: loadAtlas('heavy') };
const atlasOf = (kind) => (kind === 2 ? ATLAS.grunt : kind === 3 ? ATLAS.heavy : ATLAS.hero);

/** The outline of player p's ring on the screen (its outer edge at y FX_Y) as a polygon of pixels. */
function outline(st, p) {
  const r = st['nr.fx_radius'][p], x = st['nr.hero_pos'][p * 3], lane = st['nr.hero_pos'][p * 3 + 1], cam = camera(st['nr.cam_x']);
  return Array.from({ length: 180 }, (_, i) => { const a = i * 2 * Math.PI / 180; return project(cam, [x + r * Math.cos(a), C.FX_Y, lane + r * Math.sin(a)]); });
}
const inside = (poly, x, y, margin = 0) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  if (c || !margin) return c;
  return [[margin, 0], [-margin, 0], [0, margin], [0, -margin]].some(([dx, dy]) => inside(poly, x + dx, y + dy));
};

/** One capture of the ordering check: native with the ring, the control without, and the assertions. */
function ordering(name, tick, input, p) {
  const on = run('nr_look', join(OUT, name), tick, input, RING_EXE), off = run('nr_look', join(OUT, `${name}-noring`), tick, input, CTRL_EXE);
  const st = on.st, A = readImage(on.png), B = readImage(off.png), cam = camera(st['nr.cam_x']), poly = outline(st, p);
  check(st['nr.fx_radius'][p] > 0 && JSON.stringify(st['nr.actor_state']) === JSON.stringify(off.st['nr.actor_state']) && st['nr.checksum'] === off.st['nr.checksum'],
    `${name}: the ring is on (radius ${st['nr.fx_radius'][p].toFixed(2)}) and the control run has the same simulation (same states, same checksum)`);
  const differs = (x, y) => { const o = (y * A.w + x) * 4; return A.rgba[o] !== B.rgba[o] || A.rgba[o + 1] !== B.rgba[o + 1] || A.rgba[o + 2] !== B.rgba[o + 2]; };
  let diffIn = 0, diffOut = 0, firstOut = null;
  for (let y = 0; y < A.h; y++) for (let x = 0; x < A.w; x++) {
    if (!differs(x, y)) continue;
    if (inside(poly, x, y, 4)) diffIn++;
    else { diffOut++; firstOut ??= [x, y]; }
  }
  check(diffOut === 0, `${name}: the pictures differ on ${diffIn} pixels inside the ring's outline and ${diffOut} outside it${firstOut ? ` (first at ${firstOut})` : ''}`);
  check(diffIn > 5000, `${name}: the ring changes ${diffIn} pixels (more than 5000)`);
  // an interior texel of an actor standing in the ring is not changed: the actor is drawn over the ring, below its pivot too
  let texels = 0, bad = 0, feet = 0;
  for (let i = 0; i < st['nr.actor_present'].length; i++) {
    if (!st['nr.actor_present'][i] || st['nr.actor_y'][i] !== 0) continue;
    const at = atlasOf(st['nr.actor_kind'][i]), f = at.manifest.frames[st['nr.hero_frame'][i]], pivot = f.pivot;
    const hero = { x: st['nr.hero_pos'][i * 3], z: st['nr.hero_pos'][i * 3 + 2] }, flip = st['nr.actor_facing'][i] < 0;
    const alpha = (u, v) => at.colour.rgba[((f.rect.y + v) * at.colour.w + f.rect.x + u) * 4 + 3] === 255;
    for (let v = 1; v < f.rect.h - 1; v++) for (let u = 1; u < f.rect.w - 1; u++) {
      let all = true;
      for (let dv = -1; dv <= 1 && all; dv++) for (let du = -1; du <= 1 && all; du++) all = alpha(u + du, v + dv);
      if (!all) continue;
      const [px, py] = project(cam, texelWorld(at, cam, hero, u, v, flip));
      const x = Math.floor(px), y = Math.floor(py);
      if (x < 0 || y < 0 || x >= A.w || y >= A.h || !inside(poly, x, y)) continue;
      texels++;
      if (v > pivot.y) feet++;
      if (differs(x, y)) bad++;
    }
  }
  check(texels > 1500 && bad === 0, `${name}: ${texels} interior actor texels inside the ring (${feet} below the pivot): ${bad} of them differ from the control`);
  // the ring on the street: its samples not hidden by a curb carry the player's colour
  const on_ = ringOnScreen(st, p, A, C);
  check(on_.fraction >= 0.5, `${name}: the ring's colour is on ${on_.tinted} of ${on_.samples} samples on the street (${on_.fraction.toFixed(2)})`);
  // the sidewalk (top y 0.12, z -1.9 to -3.6) and the curb (z -1.85 to -1.95, top 0.16) are drawn over the ring where the ring reaches them
  const x0 = st['nr.hero_pos'][p * 3], lane = st['nr.hero_pos'][p * 3 + 1], r = st['nr.fx_radius'][p];
  let walk = 0, walkBad = 0;
  for (let dx = -r; dx <= r; dx += 0.1) for (let z = -3.4; z <= -2.0; z += 0.1) {
    if (Math.hypot(dx, z - lane) > r * 0.97) continue;
    const [px, py] = project(cam, [x0 + dx, 0.12, z]);
    const x = Math.round(px), y = Math.round(py);
    if (x < 0 || y < 0 || x >= A.w || y >= A.h) continue;
    walk++;
    if (differs(x, y)) walkBad++;
  }
  say(`     ${name}: ${walk} sidewalk points inside the ring's outline, ${walkBad} differ from the control`);
  return { name, tick, player: p, diffIn, diffOut, texels, feet, bad, tinted: on_, walk, walkBad };
}
if (CONTROL) {
  const rs = [ordering('p1-mid', 123, LOOK, 0), ordering('p2-mid', 103, P2, 1)];
  const rejected = rs.filter((r) => r.bad > 0 || r.diffOut > 0);
  console.log(rejected.length === rs.length ? `PASS control: the ring drawn after the actors is rejected on every capture (actor texels changed: ${rs.map((r) => `${r.name} ${r.bad} of ${r.texels}, ${r.feet} below the pivot`).join('; ')})` : 'FAIL control: a ring drawn after the actors was not rejected');
  process.exit(rejected.length === rs.length ? 0 : 1);
}
const results = [ordering('p1-mid', 123, LOOK, 0), ordering('p1-fade', 128, LOOK, 0), ordering('p2-mid', 103, P2, 1)];
const p2 = results[2];
check(p2.walk > 20 && p2.walkBad === 0, `p2-mid: the ring's outline crosses the curb and the sidewalk (${p2.walk} points on the sidewalk) and the sidewalk is drawn over it (${p2.walkBad} points differ)`);

const ok = failures.length === 0;
say(ok ? 'PASS: the shockwave follows its curve, is deterministic and is ordered under the actors and the sidewalk' : `FAIL: ${failures.length} assertion(s):\n  ${failures.join('\n  ')}`);
writeFileSync(join(OUT, 'fx-check.txt'), `${lines.join('\n')}\n`);
writeFileSync(join(OUT, 'fx-check.json'), `${JSON.stringify({ ok, constants: C, special: D, curve, ordering: results, failures }, null, 2)}\n`);
if (PUBLISH) {
  mkdirSync(PUBLISH, { recursive: true });
  for (const f of ['fx-check.txt', 'fx-check.json']) copyFileSync(join(OUT, f), join(PUBLISH, f));
  for (const n of ['p1-mid', 'p1-fade', 'p2-mid']) { copyFileSync(join(OUT, `${n}.png`), join(PUBLISH, `fx-${n}.png`)); copyFileSync(join(OUT, `${n}-noring.png`), join(PUBLISH, `fx-${n}-noring.png`)); }
}
process.exit(ok ? 0 : 1);
