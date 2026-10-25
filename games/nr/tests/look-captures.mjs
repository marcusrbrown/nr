// Captures the part of the look-gate capture set that exists at Unit 2 on every host, keeping the last frame and the
// named debug state of every run:  <out>/<name>-<host>-f<frames>.png / .json
//
//   CW_TEST_GPU=desktop node games/nr/tests/look-captures.mjs --out docs/evidence/combat-slice/unit2 \
//       [--hosts native-gl,cart-gl,cart-wgpu,native-wgpu] [--only stage,solo,lit,bare]
//
// hosts:  native-gl    the native binary on GL (run-cart --host native)
//         cart-gl      the GL cart (build/cart) in headless Chromium on GL
//         cart-wgpu    the dual cart (build/cart-wgpu) in headless Chromium on WebGPU
//         native-wgpu  the native binary with CW_GPU=webgpu (Dawn on Metal, SDL's offscreen driver)
// sets:   stage  the stage: heroes on different frames (idle x3 sharing one frame, one walking), the neon lights
//                moving; ticks 60, 120, 180, 240
//         solo   one hero idle under only neon light 0, 1 or 2 (nr_solo_0..2); tick 60
//         lit    the lit-side check's builds (nr_lit_h, nr_lit_v, and their flat-normal controls) at ticks 30, 60, 180, 210
//         bare   the stage without heroes (nr_bare); tick 60 (the control for the silhouette checks)
//
// Writes <out>/captures.json: every run with its host, app, frames, exit status, output size and the state's
// cw.three.missing; and <out>/CHECKLIST.md: the owner's review checklist for these captures. Exits 1 when a run fails.
// romdev is not a host here; its capture runs in games/nr/tests/romdev-session.mjs.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };

const OUT = resolve(ROOT, opt('out', 'docs/evidence/combat-slice/unit2'));
const HOSTS = opt('hosts', 'native-gl,cart-gl,cart-wgpu,native-wgpu').split(',');
const ONLY = opt('only', 'stage,solo,lit,bare').split(',');
mkdirSync(OUT, { recursive: true });

export const SETS = {
  stage: { apps: ['nr'], frames: [60, 120, 180, 240] },
  solo: { apps: ['nr_solo_0', 'nr_solo_1', 'nr_solo_2'], frames: [60] },
  lit: { apps: ['nr_lit_h', 'nr_lit_v', 'nr_lit_h_flat', 'nr_lit_v_flat'], frames: [30, 60, 180, 210] },
  bare: { apps: ['nr_bare'], frames: [60] },
};

const gpuEnv = () => ({ ...process.env, CW_PROJECT_ROOT: ROOT, CW_TEST_GPU: process.env.CW_TEST_GPU || 'desktop' });

function nativeWgpu(app, base, frames) {
  const exe = join(ROOT, 'build/native/games/nr', app);
  const e = { ...process.env, CW_GPU: 'webgpu', CW_FRAMES: String(frames), CW_FRAME_HZ: '60', CW_WARMUP_SPREAD: '0', SDL_AUDIODRIVER: 'dummy',
    SDL_VIDEODRIVER: 'offscreen', CW_SCREENSHOT: `${base}.png`, CW_DEBUG_DUMP: `${base}.json`, CW_ASSETS: existsSync(`${exe}.assets`) ? `${exe}.assets` : '' };
  for (const k of ['DISPLAY', 'WAYLAND_DISPLAY', 'WAYLAND_SOCKET', 'XAUTHORITY']) delete e[k];
  const r = spawnSync(exe, [], { env: e, encoding: 'utf8', timeout: 180000 });
  if (r.status === 0) {
    const st = JSON.parse(readFileSync(`${base}.json`, 'utf8'));
    if (st['cw.gpu.api'] !== 2 || st['cw.gpu.errors']) return { status: 1, stderr: `cw.gpu.api ${st['cw.gpu.api']} cw.gpu.errors ${st['cw.gpu.errors']}` };
  }
  return r;
}

function runHost(host, app, base, frames) {
  const input = 'games/nr/tests/input-idle.json';
  if (host === 'native-gl') return spawnSync('node', ['deps/cartwheel-engine/tools/run-cart.mjs', '--host', 'native', '--app', app, '--frames', String(frames), '--shot', `${base}.png`, '--state', `${base}.json`, '--gpu', 'gl', '--input', input], { cwd: ROOT, encoding: 'utf8', env: gpuEnv() });
  if (host === 'cart-gl') return spawnSync('node', ['deps/cartwheel-engine/tools/run-cart.mjs', '--host', 'chromium', '--app', app, '--cart', join(ROOT, 'build/cart/carts', `${app}.wasc`), '--frames', String(frames), '--shot', `${base}.png`, '--state', `${base}.json`, '--gpu', 'gl', '--input', input], { cwd: ROOT, encoding: 'utf8', env: gpuEnv() });
  if (host === 'cart-wgpu') return spawnSync('node', ['games/litspike/tests/chromium-wgpu.mjs', '--cart', join(ROOT, 'build/cart-wgpu/carts', `${app}.wasc`), '--frames', String(frames), '--shot', `${base}.png`, '--state', `${base}.json`, '--gpu', 'webgpu'], { cwd: ROOT, encoding: 'utf8', env: gpuEnv() });
  if (host === 'native-wgpu') return nativeWgpu(app, base, frames);
  throw new Error(`unknown host ${host}`);
}

function pngSize(path) {
  const d = readFileSync(path);
  return [d.readUInt32BE(16), d.readUInt32BE(20)];
}

const runs = [];
let failed = 0;
for (const host of HOSTS) {
  for (const set of ONLY) {
    for (const app of SETS[set].apps) {
      for (const frames of SETS[set].frames) {
        const name = `${app.replace(/^nr_?/, '') || 'stage'}`;
        const base = join(OUT, `${name}-${host}-f${frames}`);
        const r = runHost(host, app, base, frames);
        const ok = r.status === 0 && existsSync(`${base}.png`) && existsSync(`${base}.json`);
        const state = ok ? JSON.parse(readFileSync(`${base}.json`, 'utf8')) : null;
        const row = { host, app, frames, ok, size: ok ? pngSize(`${base}.png`) : null, missing: state?.['cw.three.missing'] ?? null, ticks: state?.['nr.ticks'] ?? null,
          file: `${name}-${host}-f${frames}.png` };
        runs.push(row);
        console.log(`${host.padEnd(11)} ${app.padEnd(14)} f${String(frames).padEnd(4)} ${ok ? `ok ${row.size.join('x')} missing ${row.missing} ticks ${row.ticks}` : `FAIL exit ${r.status} ${(r.stderr || r.stdout || '').slice(-300)}`}`);
        if (!ok) failed++;
      }
    }
  }
}
writeFileSync(join(OUT, 'captures.json'), `${JSON.stringify({ hosts: HOSTS, sets: ONLY, runs }, null, 2)}\n`);
writeFileSync(join(OUT, 'CHECKLIST.md'), `# Unit 2 look-gate checklist (owner review)

Captures in this directory, per host (native-gl, cart-gl, cart-wgpu, native-wgpu): \`stage-<host>-f60|120|180|240.png\`
(three heroes sharing one frame at the belt's left, centre and right, one walking a lane nearer; the three neon lights
sweeping), \`solo_<n>-<host>-f60.png\` (the hero idle under only neon light n), \`lit_*\` (the lit-side check's builds),
\`bare-<host>-f60.png\` (the stage without heroes).

Mark each when reviewed, and say what to tune in tools/render/profiles/hero.json or in the lights:

- [ ] Hero silhouette reads at 640x360 scene resolution (head, arms, legs distinguishable)
- [ ] Neon colour retexture: jacket, trim, gloves, boots, belt, visor read as intended
- [ ] Hero height: ~128 scene px of a 360 px frame (the density lock)
- [ ] Each neon light's colour reads on the hero's lit side (solo_0 magenta, solo_1 cyan, solo_2 amber)
- [ ] Normal map reads as form shading, not noise, and the lit side follows the moving lights in stage-*-f60..240
- [ ] Hero at the far left and far right of the belt is not visibly distorted
- [ ] Nearest-neighbour 3x upscale looks crisp (no filtering seams) on the native captures
- [ ] The cart captures show the same scene as native (host output sizes are in captures.json)
- [ ] Ground and wall backdrop are placeholders; judge the hero, not the street

The camera lock waits for Unit 4's occlusion and scroll captures.
`);
console.log(failed ? `${failed} run(s) failed` : `${runs.length} runs ok -> ${OUT}`);
process.exit(failed ? 1 : 0);
