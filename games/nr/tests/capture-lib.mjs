// Runs of the nr apps on WebGPU for the capture scripts: the native binary (Dawn on Metal, SDL's offscreen driver) and
// the dual cart (build/cart-wgpu) in headless Chromium, each for N frames on an optional input script, writing the last
// frame and the debug state. The input script is run-cart.mjs's format restricted to pad buttons for pads 1 and 2.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

// cw_pad_button bits of the native platform's CW_INPUT file
const CW_BITS = { south: 0, east: 1, west: 2, north: 3, back: 4, guide: 5, start: 6, l3: 7, r3: 8, l: 9, r: 10, up: 11, down: 12, left: 13, right: 14 };
const mask = (names) => (names || []).reduce((m, n) => {
  if (!(n in CW_BITS)) throw new Error(`unknown button ${n}`);
  return m | (1 << CW_BITS[n]);
}, 0);

/** Writes the native platform's input file for a script and returns its path; the platform applies an entry at the start of engine frame `frame`. */
export function nativeInputFile(scriptPath, dir) {
  mkdirSync(dir, { recursive: true });
  const script = JSON.parse(readFileSync(resolve(ROOT, scriptPath), 'utf8'));
  const line = (s) => `${s.frame - 1} ${mask(s.buttons)} 0 0 0 0 0 0${s.pad2 ? ` p=${mask(s.pad2.buttons)},0,0` : ''}`;
  const f = join(dir, `${scriptPath.replace(/[^\w]+/g, '_')}.txt`);
  writeFileSync(f, `${script.map(line).join('\n')}\n`);
  return f;
}

const gpuEnv = () => ({ ...process.env, CW_PROJECT_ROOT: ROOT, CW_TEST_GPU: process.env.CW_TEST_GPU || 'desktop' });

/** The native binary of `app` (a path under build/native/games/nr, or `exe`) on WebGPU; status 0 and the state's WebGPU counters checked. */
export function nativeWgpu(app, base, frames, { input = null, exe = null, inputDir = join(ROOT, 'out/unit4/input') } = {}) {
  const bin = exe ? resolve(exe) : join(ROOT, 'build/native/games/nr', app);
  const e = { ...process.env, CW_GPU: 'webgpu', CW_FRAMES: String(frames), CW_FRAME_HZ: '60', CW_WARMUP_SPREAD: '0', SDL_AUDIODRIVER: 'dummy',
    SDL_VIDEODRIVER: 'offscreen', CW_SCREENSHOT: `${base}.png`, CW_DEBUG_DUMP: `${base}.json`, CW_ASSETS: existsSync(`${bin}.assets`) ? `${bin}.assets` : '' };
  if (input) e.CW_INPUT = nativeInputFile(input, inputDir);
  for (const k of ['DISPLAY', 'WAYLAND_DISPLAY', 'WAYLAND_SOCKET', 'XAUTHORITY']) delete e[k];
  const r = spawnSync(bin, [], { env: e, encoding: 'utf8', timeout: 180000 });
  if (r.status === 0) {
    const st = JSON.parse(readFileSync(`${base}.json`, 'utf8'));
    if (st['cw.gpu.api'] !== 2 || st['cw.gpu.errors']) return { status: 1, stderr: `cw.gpu.api ${st['cw.gpu.api']} cw.gpu.errors ${st['cw.gpu.errors']}` };
  }
  return r;
}

/** The dual cart of `app` in headless Chromium on WebGPU (or GL with gpu: 'gl'). */
export const cartWgpu = (app, base, frames, { input = null, gpu = 'webgpu', cart = null } = {}) =>
  spawnSync('node', ['games/nr/tests/chromium-wgpu.mjs', '--cart', cart ? resolve(cart) : join(ROOT, 'build/cart-wgpu/carts', `${app}.wasc`), '--frames', String(frames),
    '--shot', `${base}.png`, '--state', `${base}.json`, '--gpu', gpu, ...(input ? ['--input', input] : [])], { cwd: ROOT, encoding: 'utf8', env: gpuEnv() });
