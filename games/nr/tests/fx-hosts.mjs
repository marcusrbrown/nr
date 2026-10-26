#!/usr/bin/env node
// The shockwave on every host the programs are measured on: the native binary and the dual cart, each on WebGPU and on GL, at the ticks where
// the ring is on the screen (mid-expansion, at the hit radius, mid-fade; player 2's). For each: cw.three.missing is 0 (the ring's program state,
// `basic`, is in three.c's own table; games/nr/programs/nr.txt gains no row), the published ring and flash are the ones the state tick
// gives, the checksums are equal across the hosts, and the cart's picture is pixel-identical to the native's
// on the same backend. WebGPU and GL blend an additive draw in different spaces, so their pictures are not compared with each other.
//
//   CW_TEST_GPU=desktop node games/nr/tests/fx-hosts.mjs [--out out/round4/hosts] [--publish docs/evidence/combat-slice/round4]
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT } from './brawler.mjs';
import { readImage } from './look-lib.mjs';
import { cartWgpu, nativeInputFile, nativeWgpu } from './capture-lib.mjs';
import { fxAt } from './fx-lib.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const OUT = resolve(ROOT, opt('out', 'out/round4/hosts'));
const PUBLISH = opt('publish') ? resolve(ROOT, opt('publish')) : null;
mkdirSync(OUT, { recursive: true });
const T = 'games/nr/tests/';
const SHOTS = [['mid', 123, `${T}input-look.json`, 0, 13], ['hit-radius', 125, `${T}input-look.json`, 0, 15], ['fade', 128, `${T}input-look.json`, 0, 18], ['p2-mid', 103, `${T}input-fx-p2.json`, 1, 13]];
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const lines = [], rows = [];
let bad = 0;
const say = (s) => { lines.push(s); console.log(s); };

function nativeGl(app, base, frames, input) {
  const bin = join(ROOT, 'build/native/games/nr', app);
  const env = { ...process.env, CW_GPU: 'gl', CW_FRAMES: String(frames), CW_FRAME_HZ: '60', CW_WARMUP_SPREAD: '0', SDL_AUDIODRIVER: 'dummy', SDL_VIDEODRIVER: 'offscreen',
    CW_SCREENSHOT: `${base}.png`, CW_DEBUG_DUMP: `${base}.json`, CW_ASSETS: existsSync(`${bin}.assets`) ? `${bin}.assets` : '', CW_INPUT: nativeInputFile(input, join(OUT, 'input')) };
  for (const k of ['DISPLAY', 'WAYLAND_DISPLAY', 'WAYLAND_SOCKET', 'XAUTHORITY']) delete env[k];
  return spawnSync(bin, [], { env, encoding: 'utf8', timeout: 180000 });
}
function differing(a, b) {
  const A = readImage(a), B = readImage(b);
  if (A.w !== B.w || A.h !== B.h) return -1;
  let n = 0;
  for (let i = 0; i < A.w * A.h * 4; i += 4) if (A.rgba[i] !== B.rgba[i] || A.rgba[i + 1] !== B.rgba[i + 1] || A.rgba[i + 2] !== B.rgba[i + 2]) n++;
  return n;
}

for (const [name, tick, input, p, stateTick] of SHOTS) {
  const b = (h) => join(OUT, `${name}-${h}`);
  const run = {
    'native-webgpu': () => nativeWgpu('nr_look', b('native-webgpu'), tick, { input, inputDir: join(OUT, 'input') }),
    'cart-webgpu': () => cartWgpu('nr_look', b('cart-webgpu'), tick, { input, gpu: 'webgpu' }),
    'native-gl': () => nativeGl('nr_look', b('native-gl'), tick, input),
    'cart-gl': () => cartWgpu('nr_look', b('cart-gl'), tick, { input, gpu: 'gl', cart: join(ROOT, 'build/cart/carts/nr_look.wasc') }),
  };
  const st = {};
  for (const [host, f] of Object.entries(run)) {
    const r = f();
    if (r.status !== 0) { bad++; say(`FAIL ${name} ${host}: exit ${r.status} ${(r.stderr || '').slice(-200)}`); continue; }
    st[host] = readJson(`${b(host)}.json`);
  }
  const want = fxAt(stateTick), near = (x, y) => Math.abs(x - y) <= 1e-5 * Math.max(1, Math.abs(y));
  for (const [host, s] of Object.entries(st)) {
    const ok = s['cw.three.missing'] === 0 && near(s['nr.fx_radius'][p], want.radius) && near(s['nr.fx_alpha'][p], want.scale) && near(s['nr.fx_flash'], want.flash) && s['nr.actor_state_tick'][p] === stateTick;
    if (!ok) bad++;
    rows.push({ shot: name, tick, host, missing: s['cw.three.missing'], radius: s['nr.fx_radius'][p], scale: s['nr.fx_alpha'][p], flash: s['nr.fx_flash'], checksum: s['nr.checksum'] });
    say(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(10)} t${tick} ${host.padEnd(13)} cw.three.missing ${s['cw.three.missing']}, ring radius ${s['nr.fx_radius'][p].toFixed(2)} scale ${s['nr.fx_alpha'][p].toFixed(3)} flash ${s['nr.fx_flash'].toFixed(2)}`);
  }
  const sums = new Set(Object.values(st).map((s) => `${s['nr.checksum']}/${s['nr.sim_checksum']}`));
  if (sums.size !== 1) { bad++; say(`FAIL ${name}: the hosts' checksums differ: ${[...sums].join(' ')}`); }
  for (const api of ['webgpu', 'gl']) {
    if (!st[`native-${api}`] || !st[`cart-${api}`]) continue;
    const n = differing(`${b(`native-${api}`)}.png`, `${b(`cart-${api}`)}.png`);
    if (n !== 0) bad++;
    say(`${n === 0 ? 'ok  ' : 'FAIL'} ${name.padEnd(10)} t${tick} ${api}: cart vs native ${n === 0 ? 'identical pixels' : `${n} pixels differ`}`);
    rows.push({ shot: name, tick, compare: `cart-vs-native ${api}`, differingPixels: n });
  }
}
say(bad ? `FAIL: ${bad} problem(s)` : 'PASS: cw.three.missing is 0 on native and cart, WebGPU and GL, with the ring on the screen; each cart is pixel-identical to the native on its backend');
writeFileSync(join(OUT, 'fx-hosts.txt'), `${lines.join('\n')}\n`);
writeFileSync(join(OUT, 'fx-hosts.json'), `${JSON.stringify({ bad, rows }, null, 2)}\n`);
if (PUBLISH) {
  mkdirSync(PUBLISH, { recursive: true });
  for (const f of ['fx-hosts.txt', 'fx-hosts.json']) copyFileSync(join(OUT, f), join(PUBLISH, f));
  for (const h of ['native-webgpu', 'native-gl']) copyFileSync(join(OUT, `mid-${h}.png`), join(PUBLISH, `fx-hosts-mid-${h}.png`)); // the two backends' pictures of one tick, for the eye
}
process.exit(bad ? 1 : 0);
