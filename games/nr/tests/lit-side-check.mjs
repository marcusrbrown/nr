// Checks that the lit side of a non-instanced hero follows a moving light, per host and per axis, from the captures
// look-captures.mjs wrote (nr_lit_h / nr_lit_v and their flat-normal controls); hosts: native, cart (both WebGPU).
//
//   node games/nr/tests/lit-side-check.mjs --dir out/unit2/caps --hosts native,cart \
//       [--facing left] [--min-ratio 2] [--report <file.json>]
//
// --facing left measures the nr_lit_*_left builds, where the hero is drawn on the mirrored plane (anim.h): the atlas
// frame is mirrored about the hero's pivot and its normals' x is negated, so a texel whose normal pointed to the
// sprite's right is a left-facing one in the world, and the same predicates must hold.
//
// The hero is held on idle frame 0 at x = 0 under one light (intensity 20) on a sweep of 240 ticks: along x (h) or
// along y (v). Its opaque texels are classed by the normal sheet: left-facing (normal x < -0.3), right-facing (> 0.3),
// up-facing (normal y > 0.3), down-facing (< -0.3). Each texel is projected through the belt camera to the screenshot
// and the class's mean luminance read. For the horizontal sweep D_h = lum(left-facing) - lum(right-facing); for the
// vertical one D_v = lum(up-facing) - lum(down-facing).
//
//   1. sign(D - D_flat) agrees with the light's side in every frame where the light is 0.5 or more off the hero's
//      centre (a light to the hero's left lights left-facing texels more: D_h > 0; a light above: D_v > 0), where
//      D_flat is the same frame of the flat-normal control: the two classes' albedo differ, and the control, which has
//      the same colours and lights, cancels that offset so what is left comes from the normal map; with state
//      cw.three.missing == 0 and the body not dark;
//   2. the swing S = D(frame 60) - D(frame 180) (and D(30) - D(210)) is negative for h (light right, then left) and
//      positive for v (above, then below): albedo differences between classes cancel in S;
//   3. |S| of the normal-mapped build is at least --min-ratio times |S| of the flat-normal control, on both axes,
//      so the response comes from the normal map.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CAM, ROOT, camera, capBase, frameTexels, loadAtlas, lum, project, readImage, texelWorld } from './look-lib.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const DIR = resolve(ROOT, opt('dir', 'out/unit2/caps'));
const HOSTS = opt('hosts', 'native,cart').split(',');
const MIN_RATIO = +opt('min-ratio', 2);
const LEFT = opt('facing', 'right') === 'left';
const SUFFIX = LEFT ? '_left' : '';
const FRAMES = [30, 60, 180, 210];
const HERO = { x: 0, z: 0 };
const HERO_CENTRE_Y = 1.0; // the standing hero is 2 units tall
const PUSH_MIN = 0.5, BODY_MIN = 15;
// a response (D - D_flat) within +-RESPONSE_MIN of zero is no response at all: the vertical sweep's first frame has the light 1.56 above the
// hero's centre, where the small up-facing class (hair, shoulders) responds by 0.26 (Unit 5) or -0.01 (the accents' colours changed); its sign
// is not asserted, the swing ratio below is
const RESPONSE_MIN = 0.5;

const atlas = loadAtlas();
const cam = camera(0);
const texels = frameTexels(atlas, 0).map((t) => (LEFT ? { ...t, nx: -t.nx } : t));
const classes = {
  left: texels.filter((t) => t.nx < -0.3), right: texels.filter((t) => t.nx > 0.3),
  up: texels.filter((t) => t.ny > 0.3), down: texels.filter((t) => t.ny < -0.3),
};
const screen = new Map();
for (const t of texels) {
  const [x, y] = project(cam, texelWorld(atlas, cam, HERO, t.u, t.v, LEFT));
  screen.set(t, [Math.round(x), Math.round(y)]);
}

function classLum(img, list) {
  let s = 0;
  for (const t of list) { const [x, y] = screen.get(t); s += lum(img, x, y); }
  return s / list.length;
}

function measure(host, app, frames) {
  const base = capBase(DIR, host, app, frames);
  const img = readImage(`${base}.png`);
  const state = JSON.parse(readFileSync(`${base}.json`, 'utf8'));
  const lp = state['nr.light_pos'].slice(0, 3);
  const body = classLum(img, texels);
  const horizontal = app.includes('_h');
  const D = horizontal ? classLum(img, classes.left) - classLum(img, classes.right) : classLum(img, classes.up) - classLum(img, classes.down);
  const push = horizontal ? HERO.x - lp[0] : lp[1] - HERO_CENTRE_Y;
  return { frames, D, push, body, missing: state['cw.three.missing'], light: lp.map((v) => +v.toFixed(2)) };
}

let failed = 0;
const fail = (m) => { failed++; console.log(`FAIL ${m}`); };
const report = { classes: Object.fromEntries(Object.entries(classes).map(([k, v]) => [k, v.length])), hosts: {} };
console.log(`texels ${texels.length}; left ${classes.left.length} right ${classes.right.length} up ${classes.up.length} down ${classes.down.length}; screen ${CAM.sceneW * CAM.scale}x${CAM.sceneH * CAM.scale}`);
for (const host of HOSTS) {
  report.hosts[host] = {};
  console.log(`\n${host}`);
  for (const axis of ['h', 'v']) {
    const app = `nr_lit_${axis}${SUFFIX}`;
    if (!existsSync(`${capBase(DIR, host, `lit_${axis}${SUFFIX}`, FRAMES[0])}.png`)) { fail(`${host}: no ${app} captures in ${DIR}`); continue; }
    const rows = FRAMES.map((f) => measure(host, `lit_${axis}${SUFFIX}`, f));
    const flat = FRAMES.map((f) => measure(host, `lit_${axis}${SUFFIX}_flat`, f));
    const swing = (r) => [r[1].D - r[2].D, r[0].D - r[3].D];
    const S = swing(rows), Sf = swing(flat);
    report.hosts[host][axis] = { rows, flat, swing: S, flatSwing: Sf };
    console.log(` ${axis === 'h' ? 'horizontal' : 'vertical  '}  frame  D        D-flat   push   body   missing`);
    console.log(`             flat control D: ${flat.map((r) => r.D.toFixed(2)).join(', ')}`);
    console.log(`             swing S = D60-D180 ${S[0].toFixed(2)} (flat ${Sf[0].toFixed(2)}), D30-D210 ${S[1].toFixed(2)} (flat ${Sf[1].toFixed(2)})`);
    rows.forEach((r, i) => {
      r.response = r.D - flat[i].D;
      console.log(`             ${String(r.frames).padEnd(5)} ${r.D.toFixed(2).padEnd(8)} ${r.response.toFixed(2).padEnd(8)} ${r.push.toFixed(2).padEnd(6)} ${r.body.toFixed(1).padEnd(6)} ${r.missing}`);
      if (Math.abs(r.push) >= PUSH_MIN && Math.abs(r.response) >= RESPONSE_MIN && Math.sign(r.response) !== Math.sign(r.push)) fail(`${host} ${axis} f${r.frames}: D - D_flat ${r.response.toFixed(2)} and push ${r.push.toFixed(2)} differ in sign`);
      if (r.body < BODY_MIN) fail(`${host} ${axis} f${r.frames}: body luminance ${r.body.toFixed(1)} < ${BODY_MIN}`);
      if (r.missing !== 0) fail(`${host} ${axis} f${r.frames}: cw.three.missing ${r.missing}`);
    });
    const want = axis === 'h' ? -1 : 1;
    S.forEach((s, i) => { if (Math.sign(s) !== want) fail(`${host} ${axis}: swing ${i} is ${s.toFixed(2)}, expected sign ${want}`); });
    S.forEach((s, i) => {
      const ratio = Math.abs(s) / Math.max(Math.abs(Sf[i]), 1e-6);
      console.log(`             ratio swing ${i}: ${ratio.toFixed(2)}x`);
      report.hosts[host][axis][`ratio${i}`] = ratio;
      if (ratio < MIN_RATIO) fail(`${host} ${axis}: swing ${i} is only ${ratio.toFixed(2)}x the flat control's (need ${MIN_RATIO}x)`);
    });
  }
}
if (opt('report')) writeFileSync(resolve(ROOT, opt('report')), `${JSON.stringify(report, null, 2)}\n`);
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
