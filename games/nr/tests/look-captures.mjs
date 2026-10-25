// Captures the look-gate capture set that exists so far: one set of pictures, taken on the native binary and on the
// cart, both on WebGPU, plus a state-only run of every app on GL as a cheap gate.
//
//   CW_TEST_GPU=desktop node games/nr/tests/look-captures.mjs --out out/unit4/caps [--only scroll,pillar] [--publish docs/evidence/combat-slice/unit4]
//
// The native binary (CW_GPU=webgpu, Dawn on Metal, SDL's offscreen driver) takes the set; the dual cart
// (build/cart-wgpu) in headless Chromium on WebGPU takes the same set into <out>/cart/. The two are one content seen
// by two hosts: for every capture <out>/captures.json records, in `hosts`, the cart's size against the native's, whether
// the pixels are identical, how many differ and by how much at most, and whether the simulation state (tick, positions,
// clip steps, lights, checksum) is equal. The GL runs (native binary on GL, GL cart in Chromium) write no pictures:
// they run every app for 60 frames and record cw.three.missing, the output sizes and the state checksum under `gl`.
//
// sets:  scroll  the street block with two players scrolling it on input-scroll.json (the belt scroll): ticks 61 (both
//                at one x, the camera centred on them), 232 (the trailing player at the left edge, the leader at the soft
//                wall), 352, 426 (mid-scroll, the pillar and the signs in view), 640 (the end of the street)
//        pillar  input-pillar.json at tick 243 on `nr` (the actors drawn) and on `nr_arena_bare` (the same street and
//                lights without them): one player behind the pillar, a stand-in in front of it
//        stage   the Unit 2 stage (nr_stage): heroes on different frames (three on one idle frame, one walking), the
//                neon lights moving; ticks 60, 120, 180, 240
//        solo    one hero idle under only neon light 0, 1 or 2 (nr_solo_*); tick 60
//        lit     the lit-side check's builds (nr_lit_h, nr_lit_v and their flat-normal controls); ticks 30, 60, 180, 210
//        bare    the Unit 2 stage without heroes (nr_bare), the control for the silhouette checks; tick 60
//
// File names: <set name>-f<tick>.png and .json, e.g. scroll-f320.png, pillar_bare-f243.png, stage-f180.png, solo_1-f60.png.
// --publish <dir> copies the review pictures (scroll, pillar, stage, solo among the sets run) and their reduced states
// (nr.*, cw.three.*, cw.gpu.*) there, with captures.json; the check inputs stay under --out.
//
// Exits 1 when a run fails, a GL run reports skipped program states, or a host differs from the native in simulation state.
// romdev is not a host here; its capture runs in games/nr/tests/romdev-session.mjs.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartWgpu, nativeWgpu } from './capture-lib.mjs';
import { readImage } from './look-lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };

const OUT = resolve(ROOT, opt('out', 'out/unit4/caps'));
const PUBLISH = opt('publish') ? resolve(ROOT, opt('publish')) : null;
const ONLY = opt('only', 'scroll,pillar,stage,solo,lit,bare').split(',');
mkdirSync(join(OUT, 'cart'), { recursive: true });
mkdirSync(join(OUT, 'gl'), { recursive: true });

const SCROLL = 'games/nr/tests/input-scroll.json', PILLAR = 'games/nr/tests/input-pillar.json', IDLE = 'games/nr/tests/input-idle.json';
// a run: the app, the name its files take, the input script, the ticks; `gl` is how many frames its GL state run takes
export const SETS = {
  scroll: { runs: [{ app: 'nr', name: 'scroll', input: SCROLL, frames: [61, 232, 352, 426, 640] }], gl: { frames: 760 } },
  pillar: { runs: [{ app: 'nr', name: 'pillar', input: PILLAR, frames: [243] }, { app: 'nr_arena_bare', name: 'pillar_bare', input: PILLAR, frames: [243] }], gl: { frames: 300 } },
  stage: { runs: [{ app: 'nr_stage', name: 'stage', input: IDLE, frames: [60, 120, 180, 240] }], gl: { frames: 60 } },
  solo: { runs: ['nr_solo_0', 'nr_solo_1', 'nr_solo_2'].map((app) => ({ app, name: app.replace(/^nr_/, ''), input: IDLE, frames: [60] })), gl: { frames: 60 } },
  lit: { runs: ['nr_lit_h', 'nr_lit_v', 'nr_lit_h_flat', 'nr_lit_v_flat'].map((app) => ({ app, name: app.replace(/^nr_/, ''), input: IDLE, frames: [30, 60, 180, 210] })), gl: { frames: 60 } },
  bare: { runs: [{ app: 'nr_bare', name: 'bare', input: IDLE, frames: [60] }], gl: { frames: 60 } },
};
const REVIEW = ['scroll', 'pillar', 'stage', 'solo'];

const glRun = (host, app, state, input, frames) => spawnSync('node', ['deps/cartwheel-engine/tools/run-cart.mjs', '--host', host === 'native-gl' ? 'native' : 'chromium', '--app', app,
  ...(host === 'cart-gl' ? ['--cart', join(ROOT, 'build/cart/carts', `${app}.wasc`)] : []), '--frames', String(frames), '--state', state, '--gpu', 'gl', '--input', input],
{ cwd: ROOT, encoding: 'utf8', env: { ...process.env, CW_PROJECT_ROOT: ROOT, CW_TEST_GPU: process.env.CW_TEST_GPU || 'desktop' } });

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const pngSize = (p) => { const d = readFileSync(p); return [d.readUInt32BE(16), d.readUInt32BE(20)]; };
const SIM = ['nr.ticks', 'nr.hero_pos', 'nr.hero_clip', 'nr.hero_step', 'nr.hero_frame', 'nr.light_pos', 'nr.light_intensity', 'nr.cam_x', 'nr.cam_left', 'nr.checksum'];
const simEqual = (a, b) => SIM.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));

function comparePixels(a, b) {
  const A = readImage(a), B = readImage(b);
  if (A.w !== B.w || A.h !== B.h) return { sameSize: false };
  let differing = 0, max = 0;
  for (let i = 0; i < A.w * A.h; i++) {
    let d = 0;
    for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(A.rgba[i * 4 + c] - B.rgba[i * 4 + c]));
    if (d) differing++;
    if (d > max) max = d;
  }
  return { sameSize: true, identical: differing === 0, differingPixels: differing, maxChannelDiff: max };
}

const runs = [];
let failed = 0;
for (const set of ONLY) {
  for (const { app, name, input, frames: list } of SETS[set].runs) {
    for (const frames of list) {
      const nat = join(OUT, `${name}-f${frames}`), cart = join(OUT, 'cart', `${name}-f${frames}`);
      const rn = nativeWgpu(app, nat, frames, { input }), rc = cartWgpu(app, cart, frames, { input });
      const okN = rn.status === 0 && existsSync(`${nat}.png`) && existsSync(`${nat}.json`);
      const okC = rc.status === 0 && existsSync(`${cart}.png`) && existsSync(`${cart}.json`);
      const row = { set, app, frames, input, file: `${name}-f${frames}.png`, native: okN ? { size: pngSize(`${nat}.png`), missing: readJson(`${nat}.json`)['cw.three.missing'] } : null,
        cart: okC ? { size: pngSize(`${cart}.png`), missing: readJson(`${cart}.json`)['cw.three.missing'] } : null };
      if (okN && okC) {
        row.hosts = { cartVsNative: { ...comparePixels(`${nat}.png`, `${cart}.png`), simStateEqual: simEqual(readJson(`${nat}.json`), readJson(`${cart}.json`)) } };
        if (!row.hosts.cartVsNative.simStateEqual) failed++;
        if (row.native.missing !== 0 || row.cart.missing !== 0) failed++;
      } else failed++;
      runs.push(row);
      const h = row.hosts?.cartVsNative;
      console.log(`${app.padEnd(14)} f${String(frames).padEnd(4)} native ${okN ? `${row.native.size.join('x')} missing ${row.native.missing}` : `FAIL ${(rn.stderr || rn.stdout || '').slice(-200)}`} | cart ${okC ? `${row.cart.size.join('x')} missing ${row.cart.missing}` : `FAIL ${(rc.stderr || rc.stdout || '').slice(-200)}`}${h ? ` | cart vs native: ${h.sameSize ? (h.identical ? 'identical pixels' : `${h.differingPixels} px differ, max ${h.maxChannelDiff}`) : 'sizes differ'}, sim state ${h.simStateEqual ? 'equal' : 'DIFFERS'}` : ''}`);
    }
  }
}

// ── GL: states only ─────────────────────────────────────────────────────────────────────────────────────────────────
const gl = [];
for (const set of ONLY) {
  for (const { app, name, input } of SETS[set].runs) {
    const row = { app, name, input, frames: SETS[set].gl.frames };
    for (const host of ['native-gl', 'cart-gl']) {
      const state = join(OUT, 'gl', `${name}-${host}.json`);
      const r = glRun(host, app, state, input, row.frames);
      if (r.status !== 0) { row[host] = { error: (r.stderr || r.stdout || '').slice(-200) }; failed++; continue; }
      const st = readJson(state);
      row[host] = { missing: st['cw.three.missing'], px: st['nr.px'], checksum: st['nr.checksum'], ticks: st['nr.ticks'], api: st['cw.gpu.api'] };
      if (st['cw.three.missing'] !== 0) failed++;
    }
    const a = row['native-gl'], b = row['cart-gl'];
    row.simChecksumEqual = !!a?.checksum && a.checksum === b?.checksum;
    if (!row.simChecksumEqual) failed++;
    gl.push(row);
    console.log(`${name.padEnd(14)} GL  ${row.frames} frames: native missing ${a?.missing} cart missing ${b?.missing} checksum ${row.simChecksumEqual ? 'equal' : 'DIFFERS'}`);
  }
}

const report = { hosts: { native: 'native binary on WebGPU (Dawn, Metal, offscreen)', cart: 'build/cart-wgpu in headless Chromium on WebGPU', gl: 'state-only: native binary on GL and build/cart in headless Chromium on GL' }, sets: ONLY, runs, gl };
writeFileSync(join(OUT, 'captures.json'), `${JSON.stringify(report, null, 2)}\n`);

if (PUBLISH) {
  mkdirSync(PUBLISH, { recursive: true });
  const keep = (s) => Object.fromEntries(Object.entries(s).filter(([k]) => /^(nr\.|cw\.three\.|cw\.gpu\.)/.test(k)));
  for (const r of runs.filter((x) => REVIEW.includes(x.set))) {
    const base = r.file.replace(/\.png$/, '');
    copyFileSync(join(OUT, r.file), join(PUBLISH, r.file));
    writeFileSync(join(PUBLISH, `${base}.json`), `${JSON.stringify(keep(readJson(join(OUT, `${base}.json`))), null, 1)}\n`);
  }
  copyFileSync(join(OUT, 'captures.json'), join(PUBLISH, 'captures.json'));
}
console.log(failed ? `${failed} problem(s)` : `${runs.length} capture runs on 2 hosts and ${gl.length} GL state runs ok -> ${OUT}`);
process.exit(failed ? 1 : 0);
