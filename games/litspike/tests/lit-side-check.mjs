// Checks that the lit side of the middle actor follows the lights, per host, from the screenshots and states
// capture-hosts.mjs wrote:
//
//   node games/litspike/tests/lit-side-check.mjs --dir out/litspike/shots --hosts native,chromium \
//       [--frames 60,120,180,240] [--prefix ""] [--flat-prefix flat-] [--min-ratio 2]
//
// For each host and frame it projects the middle actor's sprite through litspike's camera, averages the luminance
// of a strip on its left and one on its right (same rows of the body), and takes D = left - right.
//
//   push   P = sum over the lights of lum_i * (x_actor - x_light_i) / d_i^3, from the state's lit.light_pos: a light
//          to the actor's left lights its left side more, so D and P share a sign. d_i is the distance from light i to the
//          actor's centre.
//   checks 1. sign(D) == sign(P) in every frame where |P| >= PUSH_MIN;
//          2. D is positive in at least one frame and negative in at least one: the lit side changes;
//          3. the actor is not dark (mean body luminance >= BODY_MIN) and its pixels are not one colour;
//          4. with --flat-prefix: the mean |D| of the normal-mapped run is at least --min-ratio times the mean |D| of
//             the control build whose normal map is flat, so the response comes from the normal map.
//
// The constants below are litspike's (main.c): camera, sprite size, actor layout, light colours.
import { join, resolve, dirname } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const { readImage } = await import(join(ROOT, 'deps/cartwheel-engine/tools/lib/png.mjs'));
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };

const DIR = resolve(ROOT, opt('dir', 'out/litspike/shots'));
const HOSTS = opt('hosts', 'native,chromium').split(',');
const FRAMES = opt('frames', '60,120,180,240').split(',').map(Number);
const PREFIX = opt('prefix', '');
const FLAT = opt('flat-prefix', null);
const MIN_RATIO = +opt('min-ratio', 2);

const PUSH_MIN = 0.02, BODY_MIN = 40;
const CAM = { pos: [0, 4, 11.5], target: [0, 0.8, 1.5], fovY: 50, near: 0.5 };
const SPRITE = { w: 1.5, h: 3.0, texW: 64, texH: 128 };
const ACTOR = { x: 0, z: 2.0 + 1 * 0.004 }; // the middle actor (index 1 of 3)
const LIGHT_LUM = [0.2126 * 1 + 0.7152 * 0.169 + 0.0722 * 0.839, 0.2126 * 0.125 + 0.7152 * 0.91 + 0.0722 * 1, 0.2126 * 1 + 0.7152 * 0.627 + 0.0722 * 0.125];
// body rows above the belt and below the head; the strips sit on the body's two flanks
const ROWS = [60, 66], LEFT = [12, 20], RIGHT = [44, 52];

const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a); return a.map((v) => v / l); };
const fwd = norm(sub(CAM.target, CAM.pos));
const right = norm(cross(fwd, [0, 1, 0]));
const up = cross(right, fwd);
function project(p, w, h) {
  const r = sub(p, CAM.pos);
  const z = dot(r, fwd), f = 1 / Math.tan((CAM.fovY * Math.PI) / 360);
  const ndcX = (dot(r, right) * f) / z / (w / h), ndcY = (dot(r, up) * f) / z;
  return [(ndcX * 0.5 + 0.5) * w, (1 - (ndcY * 0.5 + 0.5)) * h];
}
/** screen pixel box of the sprite texel box [u0,u1) x [v0,v1) of the middle actor */
function texelBox(u0, u1, v0, v1, w, h) {
  const wx = (u) => ACTOR.x + (u / SPRITE.texW - 0.5) * SPRITE.w;
  const wy = (v) => (1 - v / SPRITE.texH) * SPRITE.h;
  const a = project([wx(u0), wy(v0), ACTOR.z], w, h), b = project([wx(u1), wy(v1), ACTOR.z], w, h);
  return { x0: Math.round(Math.min(a[0], b[0])), x1: Math.round(Math.max(a[0], b[0])), y0: Math.round(Math.min(a[1], b[1])), y1: Math.round(Math.max(a[1], b[1])) };
}
function luminance(img, box) {
  let sum = 0, n = 0; const seen = new Set();
  for (let y = box.y0; y < box.y1; y++) for (let x = box.x0; x < box.x1; x++) {
    const o = (y * img.w + x) * 4;
    sum += 0.2126 * img.rgba[o] + 0.7152 * img.rgba[o + 1] + 0.0722 * img.rgba[o + 2];
    seen.add((img.rgba[o] << 16) | (img.rgba[o + 1] << 8) | img.rgba[o + 2]);
    n++;
  }
  return { mean: sum / n, colours: seen.size, pixels: n };
}

function measure(prefix, host, frames) {
  const img = readImage(join(DIR, `${prefix}${host}-f${frames}.png`));
  const state = JSON.parse(readFileSync(join(DIR, `${prefix}${host}-f${frames}.json`), 'utf8'));
  const l = luminance(img, texelBox(LEFT[0], LEFT[1], ROWS[0], ROWS[1], img.w, img.h));
  const r = luminance(img, texelBox(RIGHT[0], RIGHT[1], ROWS[0], ROWS[1], img.w, img.h));
  const body = luminance(img, texelBox(12, 52, ROWS[0], ROWS[1], img.w, img.h));
  const lp = state['lit.light_pos'];
  let push = 0;
  for (let i = 0; i < 3; i++) {
    const L = lp.slice(i * 3, i * 3 + 3);
    const d = Math.hypot(L[0] - ACTOR.x, L[1] - 1.5, L[2] - ACTOR.z);
    push += (LIGHT_LUM[i] * (ACTOR.x - L[0])) / (d * d * d);
  }
  return { frames, left: l.mean, right: r.mean, D: l.mean - r.mean, push, body: body.mean, colours: body.colours, missing: state['cw.three.missing'], ticks: state['lit.ticks'] };
}

let failed = 0;
const fail = (m) => { failed++; console.log(`FAIL ${m}`); };
const report = { frames: FRAMES, hosts: {} };
for (const host of HOSTS) {
  const rows = FRAMES.map((f) => measure(PREFIX, host, f));
  const flat = FLAT && existsSync(join(DIR, `${FLAT}${host}-f${FRAMES[0]}.png`)) ? FRAMES.map((f) => measure(FLAT, host, f)) : null;
  report.hosts[host] = { rows, flat };
  console.log(`\n${host}`);
  console.log('frame  left    right   D       push      body   colours missing');
  for (const r of rows)
    console.log(`${String(r.frames).padEnd(6)} ${r.left.toFixed(1).padEnd(7)} ${r.right.toFixed(1).padEnd(7)} ${r.D.toFixed(1).padEnd(7)} ${r.push.toFixed(4).padEnd(9)} ${r.body.toFixed(1).padEnd(6)} ${String(r.colours).padEnd(7)} ${r.missing}`);
  for (const r of rows) {
    if (Math.abs(r.push) >= PUSH_MIN && Math.sign(r.D) !== Math.sign(r.push)) fail(`${host} f${r.frames}: D ${r.D.toFixed(1)} and push ${r.push.toFixed(4)} differ in sign`);
    if (r.body < BODY_MIN) fail(`${host} f${r.frames}: actor body luminance ${r.body.toFixed(1)} < ${BODY_MIN}`);
    if (r.colours < 8) fail(`${host} f${r.frames}: only ${r.colours} colours on the actor body`);
    if (r.missing !== 0) fail(`${host} f${r.frames}: cw.three.missing ${r.missing}`);
  }
  if (!rows.some((r) => r.D > 0) || !rows.some((r) => r.D < 0)) fail(`${host}: D never changes sign across frames ${FRAMES.join('/')}`);
  const meanAbs = (a) => a.reduce((s, r) => s + Math.abs(r.D), 0) / a.length;
  console.log(`mean |D| ${meanAbs(rows).toFixed(1)}`);
  if (flat) {
    console.log('control (flat normal map): ' + flat.map((r) => `f${r.frames} D ${r.D.toFixed(1)}`).join(', ') + ` | mean |D| ${meanAbs(flat).toFixed(1)}`);
    const ratio = meanAbs(rows) / Math.max(meanAbs(flat), 1e-6);
    console.log(`ratio normal-mapped / flat ${ratio.toFixed(2)}`);
    if (ratio < MIN_RATIO) fail(`${host}: normal-mapped mean |D| is only ${ratio.toFixed(2)}x the flat control's (need ${MIN_RATIO}x)`);
  }
}
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
