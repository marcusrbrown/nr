// Depth-ordering gate for the spike: runs games/spike/tests/input-ordering.json to each checkpoint tick on the
// native host and asserts, by sampling pixels of the screenshot, which of two overlapping things is in front.
//
//   CW_PROJECT_ROOT=<repo> CW_TEST_GPU=desktop node games/spike/tests/ordering-check.mjs
//        [--exe <spike binary>] [--out <dir>] [--app spike]
//
// For every checkpoint the overlap pixels are the pixels where both subjects are opaque (the sprite alpha mask,
// the pillar's front face), found by unprojecting each screen pixel onto each subject's plane with the scene's
// camera. Exit 0 when every assertion holds, 1 otherwise; --exe points at the reversed-depth control build.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readImage } from '../../../deps/cartwheel-engine/tools/lib/png.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const OUT = resolve(opt('--out', join(REPO, 'out', 'unit3', 'ordering')));
const APP = opt('--app', 'spike');
const EXE = opt('--exe', null);
mkdirSync(OUT, { recursive: true });

// scene constants shared with games/spike/main.c
const CAM = { pos: [0, 4.0, 11.5], target: [0, 0.8, 1.5], fov: 50, aspect: 16 / 9 };
const SPRITE = { w: 1.0, h: 1.5, tex: [32, 48] };
const PILLAR = { x: 0.8, h: 3.0, frontZ: 2.0 };
const W = 1920, H = 1080;

const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a); return a.map((v) => v / l); };
const zAxis = norm(sub(CAM.pos, CAM.target));
const xAxis = norm(cross([0, 1, 0], zAxis));
const yAxis = cross(zAxis, xAxis);
const tanH = Math.tan((CAM.fov * Math.PI) / 360);

/** pixel -> world point on the plane z = Z */
function unproject(px, py, Z) {
  const nx = ((px + 0.5) / W) * 2 - 1, ny = 1 - ((py + 0.5) / H) * 2;
  const d = [0, 1, 2].map((i) => xAxis[i] * nx * tanH * CAM.aspect + yAxis[i] * ny * tanH - zAxis[i]);
  const t = (Z - CAM.pos[2]) / d[2];
  return [CAM.pos[0] + d[0] * t, CAM.pos[1] + d[1] * t];
}

const mask = readImage(join(REPO, 'games/spike/assets/sprites/blue-left.png'));
const opaque = (tx, ty) => tx >= 0 && ty >= 0 && tx < mask.w && ty < mask.h && mask.rgba[(ty * mask.w + tx) * 4 + 3] === 255;
const solid = (tx, ty) => { for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (!opaque(tx + i, ty + j)) return false; return true; };

/** a subject answers "is this pixel one of my solid pixels?" */
const sprite = (name, a) => ({
  name,
  /** inside the sprite's rectangle, grown a little: where its outline can land */
  near(px, py) {
    const [X, Y] = unproject(px, py, a.z);
    const u = (X - a.x) / SPRITE.w + 0.5, v = (Y - a.jump) / SPRITE.h;
    return u > -0.08 && u < 1.08 && v > -0.08 && v < 1.08;
  },
  has(px, py) {
    const [X, Y] = unproject(px, py, a.z);
    const u = (X - a.x) / SPRITE.w + 0.5, v = (Y - a.jump) / SPRITE.h;
    if (u < 0 || u >= 1 || v < 0 || v >= 1) return false;
    return solid(Math.floor(u * SPRITE.tex[0]), Math.floor((1 - v) * SPRITE.tex[1]));
  },
});
const pillar = {
  name: 'pillar',
  near(px, py) { return this.has(px, py); },
  has(px, py) {
    const [X, Y] = unproject(px, py, PILLAR.frontZ);
    return Math.abs(X) < PILLAR.x - 0.05 && Y > 0.05 && Y < PILLAR.h - 0.05;
  },
};

// blue sprite pixels have blue well above red, orange ones the reverse, the lit pillar is a near-neutral grey
const hue = (r, g, b) => (b - r > 30 ? 'p0' : r - b > 30 ? 'p1' : r > 80 && g > 80 ? 'pillar' : 'other');

function pixelsOf(shot, subjects) {
  const out = [];
  for (let py = 0; py < H; py += 2) for (let px = 0; px < W; px += 2) {
    if (subjects.every((s) => s.has(px, py))) { const o = (py * W + px) * 4; out.push([shot.rgba[o], shot.rgba[o + 1], shot.rgba[o + 2]]); }
  }
  return out;
}

const input = join(HERE, 'input-ordering.json');
function run(frames) {
  const base = join(OUT, `f${frames}`);
  const r = spawnSync(process.execPath, [join(REPO, 'deps/cartwheel-engine/tools/run-cart.mjs'), '--host', 'native', '--app', APP,
    '--frames', String(frames), '--input', input, '--state', `${base}.json`, '--shot', `${base}.png`, ...(EXE ? ['--exe', resolve(EXE)] : [])],
  { env: { CW_PROJECT_ROOT: REPO, CW_TEST_GPU: 'desktop', ...process.env }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`run-cart --frames ${frames} exited ${r.status}: ${r.stderr}`);
  const st = JSON.parse(readFileSync(`${base}.json`, 'utf8'));
  const shot = readImage(`${base}.png`);
  if (shot.w !== W || shot.h !== H) throw new Error(`frame ${frames}: screenshot is ${shot.w}x${shot.h}, expected ${W}x${H}`);
  const actor = (i) => ({ x: st['spike.pos'][i * 3], y: st['spike.pos'][i * 3 + 1], z: st['spike.pos'][i * 3 + 2], jump: st['spike.jump'][i] });
  return { st, shot, p0: actor(0), p1: actor(1), base };
}

// checkpoint ticks of input-ordering.json and what each must show
const CASES = [
  { frames: 47, name: 'pillar in front of p1, p0 in front of pillar', skipSelf: ['p1'], checks: [
    { a: 'p0', b: 'pillar', expect: 'p0' }, { a: 'p1', b: 'pillar', expect: 'pillar' }] },
  { frames: 126, name: 'equal ground-y resolves by actor id', pre: (c) => Math.abs(c.p0.y - c.p1.y) < 1e-3,
    checks: [{ a: 'p0', b: 'p1', expect: 'p1' }] },
  { frames: 144, name: 'greater ground-y (p0) occludes', pre: (c) => c.p0.y > c.p1.y + 0.5, checks: [{ a: 'p0', b: 'p1', expect: 'p0' }] },
  { frames: 174, name: 'swapped: greater ground-y (p1) occludes', pre: (c) => c.p1.y > c.p0.y + 0.5, checks: [{ a: 'p0', b: 'p1', expect: 'p1' }] },
  { frames: 181, name: 'p0 airborne behind p1 stays behind', pre: (c) => c.p0.jump > 0.3 && c.p1.y > c.p0.y + 0.5, checks: [{ a: 'p0', b: 'p1', expect: 'p1' }] },
  { frames: 266, name: 'p0 airborne in front of p1 stays in front', pre: (c) => c.p0.jump > 0.8 && c.p0.y > c.p1.y + 0.5, checks: [{ a: 'p0', b: 'p1', expect: 'p0' }] },
];

const results = [];
let failed = 0;
for (const cs of CASES) {
  const c = run(cs.frames);
  const subj = { p0: sprite('p0', c.p0), p1: sprite('p1', c.p1), pillar };
  const rec = { frames: cs.frames, name: cs.name, p0: c.p0, p1: c.p1, checks: [] };
  const preOk = !cs.pre || cs.pre(c);
  rec.precondition = preOk;
  if (!preOk) { failed++; rec.error = 'scenario precondition not met'; }
  // projection sanity: each sprite's own unoccluded pixels show its own colour
  for (const who of ['p0', 'p1'].filter((w) => !(cs.skipSelf || []).includes(w))) {
    const others = Object.values(subj).filter((s) => s.name !== who);
    const own = pixelsOf(c.shot, [subj[who]]).length;
    const px = [];
    for (let py = 0; py < H; py += 2) for (let x = 0; x < W; x += 2) {
      if (subj[who].has(x, py) && !others.some((s) => s.near(x, py))) { const o = (py * W + x) * 4; px.push(hue(c.shot.rgba[o], c.shot.rgba[o + 1], c.shot.rgba[o + 2])); }
    }
    const share = px.length ? px.filter((h) => h === who).length / px.length : 0;
    const ok = px.length > 60 && share >= 0.9;
    rec.checks.push({ kind: 'self', who, solidPixels: own, unoccludedPixels: px.length, share: +share.toFixed(3), ok });
    if (!ok) failed++;
  }
  for (const chk of cs.checks) {
    const px = pixelsOf(c.shot, [subj[chk.a], subj[chk.b]]).map(([r, g, b]) => hue(r, g, b));
    const share = px.length ? px.filter((h) => h === chk.expect).length / px.length : 0;
    const ok = preOk && px.length > 150 && share >= 0.95;
    rec.checks.push({ kind: 'overlap', a: chk.a, b: chk.b, expect: chk.expect, overlapPixels: px.length, share: +share.toFixed(3), ok });
    if (!ok) failed++;
  }
  results.push(rec);
  for (const k of rec.checks) console.log(`${rec.frames} ${cs.name}: ${JSON.stringify(k)}`);
  if (rec.error) console.log(`${rec.frames} ${cs.name}: ${rec.error} ${JSON.stringify({ p0: c.p0, p1: c.p1 })}`);
}
writeFileSync(join(OUT, 'result.json'), JSON.stringify({ exe: EXE, failed, results }, null, 1) + '\n');
console.log(failed ? `FAIL: ${failed} assertion(s) failed` : 'PASS: every ordering assertion holds');
process.exit(failed ? 1 : 0);
