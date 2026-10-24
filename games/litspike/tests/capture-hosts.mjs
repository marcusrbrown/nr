// Runs litspike on each host for each frame count on the engine's fixed clock and keeps the last frame and the
// named debug state of every run:  <out>/<prefix><host>-f<frames>.png / .json
//
//   CW_TEST_GPU=desktop node games/litspike/tests/capture-hosts.mjs --out out/litspike/shots \
//       [--hosts native,chromium] [--frames 60,120,180,240] [--app litspike] [--prefix ""] \
//       [--exe <native binary>] [--cart <.wasc>] [--gpu gl|webgpu]
//
// --gpu webgpu: native runs the binary directly with CW_GPU=webgpu (Dawn on Metal, no surface, SDL's offscreen
// driver) because run-cart's --gpu webgpu reads a Linux test-GPU pin; chromium runs the dual cart
// (build/cart-wgpu, default out/litspike/build-cart-wgpu/carts/<app>.wasc) through chromium-wgpu.mjs.
//
// romdev is not a host here: its capture runs in one session (games/litspike/tests/romdev-session.mjs).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };

const OUT = resolve(ROOT, opt('out', 'out/litspike/shots'));
const HOSTS = opt('hosts', 'native,chromium').split(',');
const FRAMES = opt('frames', '60,120,180,240').split(',').map(Number);
const APP = opt('app', 'litspike');
const PREFIX = opt('prefix', '');
const GPU = opt('gpu', 'gl');
mkdirSync(OUT, { recursive: true });

const env = () => ({ ...process.env, CW_PROJECT_ROOT: ROOT, CW_TEST_GPU: process.env.CW_TEST_GPU || 'desktop' });

function nativeWgpu(base, frames) {
  const exe = opt('exe') ? resolve(ROOT, opt('exe')) : join(ROOT, 'build/native/games', APP.startsWith('litspike') ? 'litspike' : APP, APP);
  const e = { ...process.env, CW_GPU: 'webgpu', CW_FRAMES: String(frames), CW_FRAME_HZ: '60', CW_WARMUP_SPREAD: '0',
    SDL_AUDIODRIVER: 'dummy', SDL_VIDEODRIVER: 'offscreen', CW_SCREENSHOT: `${base}.png`, CW_DEBUG_DUMP: `${base}.json`,
    CW_ASSETS: existsSync(exe + '.assets') ? exe + '.assets' : '' };
  for (const k of ['DISPLAY', 'WAYLAND_DISPLAY', 'WAYLAND_SOCKET', 'XAUTHORITY']) delete e[k];
  const r = spawnSync(exe, [], { env: e, encoding: 'utf8', timeout: 120000 });
  if (r.status === 0) {
    const st = JSON.parse(readFileSync(`${base}.json`, 'utf8'));
    if (st['cw.gpu.api'] !== 2 || st['cw.gpu.errors']) return { status: 1, stderr: `cw.gpu.api ${st['cw.gpu.api']} cw.gpu.errors ${st['cw.gpu.errors']}` };
    const m = /WebGPU adapter: (.*)/.exec(r.stderr || '');
    if (frames === FRAMES[FRAMES.length - 1]) console.log(`  adapter: ${m && m[1]}`);
  }
  return r;
}

function chromiumWgpu(base, frames) {
  const cart = opt('cart') ? resolve(ROOT, opt('cart')) : join(ROOT, 'out/litspike/build-cart-wgpu/carts', `${APP}.wasc`);
  return spawnSync('node', ['games/litspike/tests/chromium-wgpu.mjs', '--cart', cart, '--frames', String(frames), '--shot', `${base}.png`,
    '--state', `${base}.json`, '--gpu', 'webgpu'], { cwd: ROOT, encoding: 'utf8', env: env() });
}

let failed = 0;
for (const host of HOSTS) {
  for (const frames of FRAMES) {
    const base = join(OUT, `${PREFIX}${host}-f${frames}`);
    if (GPU === 'webgpu') {
      const r = host === 'native' ? nativeWgpu(base, frames) : chromiumWgpu(base, frames);
      console.log(`${host} (webgpu) f${frames}: exit ${r.status} ${r.status === 0 ? '' : (r.stderr || r.stdout).slice(-400)}`);
      if (r.status !== 0) failed++;
      continue;
    }
    const args = ['deps/cartwheel-engine/tools/run-cart.mjs', '--host', host, '--app', APP, '--frames', String(frames),
      '--shot', `${base}.png`, '--state', `${base}.json`, '--gpu', GPU];
    if (opt('exe') && host === 'native') args.push('--exe', resolve(ROOT, opt('exe')));
    if (opt('cart') && host !== 'native') args.push('--cart', resolve(ROOT, opt('cart')));
    const r = spawnSync('node', args, { cwd: ROOT, encoding: 'utf8',
      env: env() });
    console.log(`${host} f${frames}: exit ${r.status} ${r.status === 0 ? '' : (r.stderr || r.stdout).slice(-400)}`);
    if (r.status !== 0) failed++;
  }
}
process.exit(failed ? 1 : 0);
