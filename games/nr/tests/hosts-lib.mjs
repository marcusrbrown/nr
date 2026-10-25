// One run of an nr script on one host, for the brawler gate's WebGPU legs, its calibration and its controls.
//
//   native          the native binary on GL            (deps/cartwheel-engine/tools/run-cart.mjs --host native)
//   romdev          build/cart on romdev, GL           (run-cart.mjs --host romdev)
//   chromium        build/cart in headless Chromium, GL (run-cart.mjs --host chromium)
//   native-wgpu     the native binary on WebGPU        (Dawn on Metal, SDL's offscreen driver; capture-lib.mjs)
//   chromium-wgpu   build/cart-wgpu in headless Chromium on WebGPU (chromium-wgpu.mjs)
//   romdev-wgpu     build/cart-wgpu on romdev, loadMedia wgpu:true (the HTTP tools below; run-cart.mjs --gpu webgpu cannot run on macOS)
//
// Every run writes <base>.png (the last frame) and <base>.json (the debug state) and returns { shot, state, ms }.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { cartWgpu, nativeWgpu } from './capture-lib.mjs';
import { ROOT } from './brawler.mjs';

/** the host each host is held to: the native binary on the same graphics API */
export const REFERENCE = { romdev: 'native', chromium: 'native', 'chromium-wgpu': 'native-wgpu', 'romdev-wgpu': 'native-wgpu' };
export const GL_HOSTS = ['romdev', 'chromium'];
export const WGPU_HOSTS = ['chromium-wgpu', 'romdev-wgpu'];

const BASE = process.env.ROMDEV_URL || 'http://localhost:7331';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function romdev(session, tool, body) {
  const r = await fetch(`${BASE}/tool/${tool}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-romdev-session': session }, body: JSON.stringify(body) });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!r.ok || json.isError || json.error) throw new Error(`romdev ${tool}${body.op ? `.${body.op}` : ''}: HTTP ${r.status}: ${String(json.error || text).slice(0, 400)}`);
  return json;
}
export const romdevCall = romdev;
export const stateOf = (st) => Object.fromEntries((st.fields || []).map((f) => [f.name, f.values ?? f.value ?? f.text]));
const pad = (buttons) => Object.fromEntries((buttons || []).map((b) => [b, true]));

/** [{input:{ports}, frames}] for engine frames from..to of a script: the entry in force at each frame (frame 1 ran in loadMedia). */
export function sequenceSteps(script, from, to) {
  const out = [];
  for (let f = from; f <= to; f++) {
    let e = script[0];
    for (const s of script) if (s.frame <= f) e = s;
    const ports = [pad(e.buttons), pad(e.pad2?.buttons)];
    const last = out[out.length - 1];
    if (last && JSON.stringify(last.input.ports) === JSON.stringify(ports)) last.frames++;
    else out.push({ input: { ports }, frames: 1 });
  }
  return out;
}

/** romdev on the dual cart with WebGPU: loadMedia (frame 1), the script's steps for frames 2..frames, a screenshot, the debug state */
export async function romdevWgpu({ session, cart, script, frames, base, deterministic = true }) {
  const t0 = Date.now();
  const loaded = await romdev(session, 'loadMedia', { platform: 'wasmcart', path: cart, wgpu: true, ...(deterministic ? { deterministicSeed: 1, deterministicStepMs: 16.6667 } : {}) });
  if (!loaded.loaded || loaded.gpu !== 'webgpu') throw new Error(`loadMedia reported gpu ${JSON.stringify(loaded.gpu)}`);
  if (frames > 1) await romdev(session, 'input', { op: 'sequence', steps: sequenceSteps(script, 2, frames) });
  mkdirSync(dirname(base), { recursive: true });
  await romdev(session, 'frame', { op: 'screenshot', path: `${base}.png` });
  const st = stateOf(await romdev(session, 'wasm', { op: 'debugState' }));
  writeFileSync(`${base}.json`, `${JSON.stringify(st)}\n`);
  return { shot: `${base}.png`, state: `${base}.json`, ms: Date.now() - t0 };
}

/* run-cart.mjs pins a test GPU on Linux; on macOS it needs CW_TEST_GPU=desktop even when gate.mjs (which needs `software`) started this process */
function spawnRun(args, env) {
  return new Promise((res) => {
    const p = spawn('node', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CW_PROJECT_ROOT: ROOT, CW_TEST_GPU: 'desktop', ...env } });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => res({ code, out, err }));
  });
}

/**
 * Runs a script on a host. `sc` is { app, input } (input a path from the repository root); `frames` the last frame; `base` the
 * output path without extension; `cart` overrides the cart of a cart host (the control builds); `session` names the romdev session.
 */
export async function runHost(host, sc, frames, base, { cart = null, session = 'nr-unit8-gate', input = sc.input } = {}) {
  const t0 = Date.now();
  mkdirSync(dirname(base), { recursive: true });
  const ok = { shot: `${base}.png`, state: `${base}.json` };
  const fail = (r) => { throw new Error(`${host} ${sc.app} ${frames}f: ${(r.stderr || r.err || r.stdout || r.out || '').trim().split('\n').slice(-3).join(' | ')}`); };
  if (host === 'native-wgpu') {
    const r = nativeWgpu(sc.app, base, frames, { input, inputDir: join(dirname(base), 'input') });
    if (r.status !== 0) fail(r);
  } else if (host === 'chromium-wgpu') {
    const r = cartWgpu(sc.app, base, frames, { input, cart });
    if (r.status !== 0) fail(r);
  } else if (host === 'romdev-wgpu') {
    await romdevWgpu({ session, cart: resolve(ROOT, cart || `build/cart-wgpu/carts/${sc.app}.wasc`), script: JSON.parse(readFileSync(resolve(ROOT, input), 'utf8')), frames, base });
  } else {
    const args = ['deps/cartwheel-engine/tools/run-cart.mjs', '--host', host, '--app', sc.app, '--frames', String(frames), '--input', resolve(ROOT, input), '--shot', ok.shot, '--state', ok.state, '--gpu', 'gl'];
    if (cart && host !== 'native') args.push('--cart', resolve(ROOT, cart));
    const r = await spawnRun(args, {});
    if (r.code !== 0) fail(r);
  }
  return { ...ok, ms: Date.now() - t0 };
}

export { sleep };
