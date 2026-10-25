// Checks of the belt scroll (games/nr/tests/input-scroll.json) on the native binary on WebGPU.
//
//   CW_TEST_GPU=desktop node games/nr/tests/scroll-check.mjs --dir out/unit4/caps [--out out/unit4/scroll] [--report <file.json>]
//
//   camera      states at 18 ticks of the script: the camera x never decreases and equals cam_left; every player stands
//               inside the frame (|x - cam| <= the frame's half width at the player's lane, as main.c's view_half());
//               both players at one x at the start leave the camera unmoved (centred) over 60 idle ticks
//   leash       tick 230 (AE4, AE8): the trailing player stands at the frame's left edge and the belt has not scrolled
//               since tick 142; the leading player stands at the soft wall, the frame's right edge
//   end         the camera stops at the street's end with both players at the arena's right bound
//   lights      the neon lights sweep over the belt (each light's x covers >= 10 units over the ticks, the three together
//               >= 20) and cw.three.missing is 0 at every tick
//   parallax    the pictures at ticks 352 and 426 (scroll-f352.png, scroll-f426.png under --dir): four emissive references
//               (the play lane pillar's band, a near shop's sign, a far tower's sign, a window of the skyline), each found
//               by colour (its right edge, which the pillar does not hide), move by
//               the shift the belt camera predicts, in the order pillar > near > far > skyline, and the near, far and
//               skyline shifts are smaller than the play lane's by the predicted ratios (the actors' own world shift is the
//               play lane's)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CAM, ROOT, camera, project, readImage } from './look-lib.mjs';
import { nativeWgpu } from './capture-lib.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const DIR = resolve(ROOT, opt('dir', 'out/unit4/caps'));
const OUT = resolve(ROOT, opt('out', 'out/unit4/scroll'));
const REPORT = opt('report') ? resolve(ROOT, opt('report')) : null;
const INPUT = 'games/nr/tests/input-scroll.json';
mkdirSync(OUT, { recursive: true });

let failed = 0;
const fail = (m) => { failed++; console.log(`FAIL ${m}`); };
const ok = (m) => console.log(`ok   ${m}`);
const report = { camera: [], leash: {}, end: {}, lights: {}, parallax: {} };

// ── states ──────────────────────────────────────────────────────────────────────────────────────────────────────
const TICKS = [1, 30, 61, 100, 142, 200, 230, 240, 300, 352, 426, 480, 560, 600, 640, 700, 760];
const states = new Map();
for (const t of TICKS) {
  const base = join(OUT, `s${t}`);
  const r = nativeWgpu('nr_dummies', base, t, { input: INPUT });
  if (r.status !== 0) { fail(`run to tick ${t}: ${(r.stderr || r.stdout || '').slice(-200)}`); continue; }
  states.set(t, JSON.parse(readFileSync(`${base}.json`, 'utf8')));
}

// the frame's half width at a lane, as main.c's view_half(): scene width / 2 / ppu, scaled by the distance, less the actor's half width
const ACTOR_HALF = 0.45;
const dist = (CAM.sceneH / CAM.ppu) / (2 * Math.tan((CAM.fovDeg * Math.PI) / 360));
const viewHalf = (lane) => (CAM.sceneW / CAM.ppu / 2) * (dist - lane * Math.cos((CAM.pitchDeg * Math.PI) / 180)) / dist - ACTOR_HALF;
const pos = (st, p) => ({ x: st['nr.hero_pos'][p * 3], lane: st['nr.hero_pos'][p * 3 + 1] });
const EPS = 1e-3;

let prev = null;
for (const t of TICKS) {
  const st = states.get(t);
  if (!st) continue;
  const cam = st['nr.cam_x'], left = st['nr.cam_left'];
  const row = { tick: t, cam, left, p0: pos(st, 0), p1: pos(st, 1), missing: st['cw.three.missing'] };
  report.camera.push(row);
  if (st['nr.ticks'] !== t) fail(`tick ${t}: the state is at tick ${st['nr.ticks']}`);
  if (prev !== null && cam < prev - 1e-6) fail(`tick ${t}: the camera scrolled back (${cam} < ${prev})`);
  if (Math.abs(cam - left) > 1e-6) fail(`tick ${t}: cam_left ${left} differs from the camera ${cam}`);
  for (const p of [0, 1]) {
    const q = pos(st, p);
    if (Math.abs(q.x - cam) > viewHalf(q.lane) + EPS) fail(`tick ${t}: player ${p} at x ${q.x.toFixed(3)} is outside the frame (camera ${cam.toFixed(3)}, half width ${viewHalf(q.lane).toFixed(3)})`);
  }
  if (st['cw.three.missing'] !== 0) fail(`tick ${t}: cw.three.missing is ${st['cw.three.missing']}`);
  prev = cam;
}
if (!failed) ok(`camera: monotonic, every player in frame, cw.three.missing 0 at ${TICKS.length} ticks`);

// both players at one x at the start: the camera has not moved over 60 idle ticks and sits on them
{
  const a = states.get(1), b = states.get(61);
  const same = pos(b, 0).x === pos(b, 1).x && pos(a, 0).x === pos(a, 1).x;
  const still = a['nr.cam_x'] === b['nr.cam_x'] && b['nr.cam_x'] === pos(b, 0).x;
  report.idle = { tick1: a['nr.cam_x'], tick61: b['nr.cam_x'], x: pos(b, 0).x, sameX: same };
  if (same && still) ok(`idle: both players at x ${pos(b, 0).x}, the camera at ${b['nr.cam_x']} at ticks 1 and 61 (no jitter)`); else fail(`idle: camera ${a['nr.cam_x']} -> ${b['nr.cam_x']}, players at ${pos(b, 0).x} and ${pos(b, 1).x}`);
}

// AE4 / AE8
{
  const st = states.get(230), s142 = states.get(142);
  const cam = st['nr.cam_x'], p0 = pos(st, 0), p1 = pos(st, 1);
  const trailAtEdge = Math.abs(p1.x - (cam - viewHalf(p1.lane))) < 0.02;
  const leadAtWall = Math.abs(p0.x - (cam + viewHalf(p0.lane))) < 0.02;
  const held = Math.abs(cam - s142['nr.cam_x']) < EPS;
  report.leash = { tick: 230, cam, camAt142: s142['nr.cam_x'], trailing: p1, leading: p0, trailAtEdge, leadAtWall, held, leashUnits: p0.x - p1.x };
  if (trailAtEdge && leadAtWall && held) ok(`leash: trailing player at the left edge (x ${p1.x.toFixed(3)}), leader at the soft wall (x ${p0.x.toFixed(3)}), camera held at ${cam.toFixed(3)} since tick 142; gap ${(p0.x - p1.x).toFixed(2)} units`);
  else fail(`leash: trailing at edge ${trailAtEdge}, leader at wall ${leadAtWall}, camera held ${held} (${JSON.stringify(report.leash)})`);
}

// the end of the street
{
  const st = states.get(760);
  const a = pos(st, 0), b = pos(st, 1), cam = st['nr.cam_x'];
  const xmax = JSON.parse(readFileSync(join(ROOT, 'games/nr/assets/arena/layout.json'), 'utf8')).bounds.x_max;
  report.end = { cam, p0: a, p1: b, xmax };
  if (cam === 20 && a.x === xmax && b.x === xmax) ok(`end: camera at ${cam}, both players at the arena's right bound ${xmax}`); else fail(`end: camera ${cam}, players at ${a.x} and ${b.x}, bound ${xmax}`);
}

// lights
{
  const span = [0, 1, 2].map((i) => {
    const xs = [...states.values()].map((st) => st['nr.light_pos'][i * 3]);
    return { light: i, min: Math.min(...xs), max: Math.max(...xs) };
  });
  const all = [Math.min(...span.map((s) => s.min)), Math.max(...span.map((s) => s.max))];
  report.lights = { perLight: span, all, flash: [...states.values()].map((st) => st['nr.light_intensity'][3]).every((v) => v === 0) };
  if (span.every((s) => s.max - s.min >= 10) && all[1] - all[0] >= 20 && report.lights.flash) ok(`lights: x spans ${span.map((s) => `${s.min.toFixed(1)}..${s.max.toFixed(1)}`).join(', ')} (together ${all[0].toFixed(1)}..${all[1].toFixed(1)}), flash slot at 0`);
  else fail(`lights: spans ${JSON.stringify(span)} flash ${report.lights.flash}`);
}

// ── parallax ────────────────────────────────────────────────────────────────────────────────────────────────────
const layout = JSON.parse(readFileSync(join(ROOT, 'games/nr/assets/arena/layout.json'), 'utf8'));
const ref = layout.reference;
const hexOf = (s) => parseInt(s.slice(1), 16);
const byEmissive = (color) => layout.solids.find((s) => s.emissive && hexOf(s.emissive) === hexOf(color));
// each reference: its world centre and a colour mask (the lights add a little of their own colour to every surface)
const REFS = [
  { name: 'pillar band (play lane)', solid: byEmissive(ref.pillar_band), mask: (r, g, b) => r > 200 && g < 140 && b < 140 && r - g > 100 && r - b > 100 },
  { name: 'near shop sign', solid: byEmissive(ref.near_sign), mask: (r, g, b) => g > 200 && g - r > 50 && g - b > 100 },
  { name: 'far tower sign', solid: byEmissive(ref.far_sign), mask: (r, g, b) => b > 200 && b - g > 50 && b - r > 30 },
  { name: 'skyline window', solid: byEmissive(ref.sky_window), mask: (r, g, b) => r > 130 && g > 200 && b < 100 },
];
const S3 = CAM.scale;
function locate(img, cam, r) {
  const s = r.solid, [cx, cy] = project(cam, [s.x, s.y, s.z]);
  // the silhouette's right edge: the front or the back corner, whichever the camera sees further right
  const ex = Math.max(project(cam, [s.x + s.w / 2, s.y, s.z + s.d / 2])[0], project(cam, [s.x + s.w / 2, s.y, s.z - s.d / 2])[0]);
  const [, y1] = project(cam, [s.x, s.y + s.h / 2, s.z]);
  const hw = Math.abs(ex - cx) + 30, hh = Math.abs(y1 - cy) + 24;
  // the pillar stands in front of the signs and hides the left part of them; the right edge of each reference is free
  let n = 0, edge = -1;
  for (let y = Math.max(0, Math.floor(cy - hh)); y < Math.min(img.h, Math.ceil(cy + hh)); y += S3) {
    for (let x = Math.max(0, Math.floor(cx - hw)); x < Math.min(img.w, Math.ceil(cx + hw)); x += S3) {
      const o = (y * img.w + x) * 4;
      if (r.mask(img.rgba[o], img.rgba[o + 1], img.rgba[o + 2])) { n++; if (x + S3 > edge) edge = x + S3; }
    }
  }
  return { expected: ex, found: n ? edge : null, pixels: n };
}
{
  const A = 352, B = 426;
  const sa = states.get(A), sb = states.get(B);
  const ca = camera(sa['nr.cam_x']), cb = camera(sb['nr.cam_x']);
  const ia = readImage(join(DIR, `scroll-f${A}.png`)), ib = readImage(join(DIR, `scroll-f${B}.png`));
  const rows = REFS.map((r) => {
    const a = locate(ia, ca, r), b = locate(ib, cb, r);
    const predicted = b.expected - a.expected, measured = a.found !== null && b.found !== null ? b.found - a.found : null;
    return { name: r.name, id: r.solid.id, depthZ: r.solid.z, pixels: [a.pixels, b.pixels], predictedShift: +predicted.toFixed(1), measuredShift: measured === null ? null : +measured.toFixed(1) };
  });
  const dcam = sb['nr.cam_x'] - sa['nr.cam_x'];
  report.parallax = { ticks: [A, B], cameraShiftUnits: dcam, actorWorldShiftPx: +(dcam * CAM.ppu * S3).toFixed(1), rows };
  let good = rows.every((r) => r.measuredShift !== null && Math.abs(r.measuredShift - r.predictedShift) <= 8 && r.pixels.every((n) => n >= 20));
  const [pl, near, far, sky] = rows.map((r) => Math.abs(r.measuredShift ?? 0));
  report.parallax.ratios = { near: +(near / pl).toFixed(3), far: +(far / pl).toFixed(3), sky: +(sky / pl).toFixed(3), predictedNear: +(rows[1].predictedShift / rows[0].predictedShift).toFixed(3), predictedFar: +(rows[2].predictedShift / rows[0].predictedShift).toFixed(3), predictedSky: +(rows[3].predictedShift / rows[0].predictedShift).toFixed(3) };
  good = good && pl > near * 1.05 && near > far * 1.05 && far > sky * 1.05 && Math.abs(report.parallax.ratios.near - report.parallax.ratios.predictedNear) < 0.03 && Math.abs(report.parallax.ratios.far - report.parallax.ratios.predictedFar) < 0.03 && Math.abs(report.parallax.ratios.sky - report.parallax.ratios.predictedSky) < 0.03;
  if (good) ok(`parallax: camera ${dcam.toFixed(2)} units; shifts (screen px) play lane ${pl}, near shop sign ${near} (x${report.parallax.ratios.near}), far tower sign ${far} (x${report.parallax.ratios.far}), skyline window ${sky} (x${report.parallax.ratios.sky}); an actor's world shift is ${report.parallax.actorWorldShiftPx}`);
  else fail(`parallax: ${JSON.stringify(report.parallax)}`);
}

if (REPORT) writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
console.log(failed ? `${failed} problem(s)` : 'all scroll checks passed');
process.exit(failed ? 1 : 0);
