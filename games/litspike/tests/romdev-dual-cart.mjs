// romdev check of the cart-wgpu litspike cart (build/cart-wgpu/carts/litspike.wasc). One `x-romdev-session` carries every call.
//
//   node games/litspike/tests/romdev-dual-cart.mjs [--out out/unit1/romdev] [--live-seconds 20] [--no-live]
//
// 1. loadMedia with wgpu:true: the response must report gpu "webgpu"; wasm{conformance} must pass; after 59 more frames
//    `cw.gpu.api` is 2, `cw.gpu.errors` and `cw.three.missing` are 0 and `lit.ticks` equals the frame count.
// 2. loadMedia of the same cart with wgpu:false: gpu "gl", `cw.gpu.api` 1, `cw.three.missing` 0.
// 3. loadMedia with wgpu:true again and host{play} for --live-seconds, so the run shows on the /livestream.
//
// Every response is appended to <out>/calls.ndjson. The script opens no window.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };

const BASE = process.env.ROMDEV_URL || 'http://localhost:7331';
const SESSION = 'nr-unit1';
const OUT = resolve(ROOT, opt('out', 'out/unit1/romdev'));
const LIVE_SECONDS = +opt('live-seconds', 20);
const CART = resolve(ROOT, 'build/cart-wgpu/carts/litspike.wasc');
mkdirSync(OUT, { recursive: true });

const log = (event, data = {}) => console.log(JSON.stringify({ event, ...data }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { throw new Error(msg); };

async function call(tool, body) {
  const r = await fetch(`${BASE}/tool/${tool}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-romdev-session': SESSION }, body: JSON.stringify(body) });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  appendFileSync(join(OUT, 'calls.ndjson'), `${JSON.stringify({ at: new Date().toISOString(), tool, body, status: r.status, response: text.length > 20000 ? `${text.slice(0, 20000)}…` : json })}\n`);
  if (!r.ok || json.isError || json.error) fail(`romdev ${tool}${body.op ? `.${body.op}` : ''}: HTTP ${r.status}: ${String(json.error || text).slice(0, 500)}`);
  return json;
}

const stateOf = (st) => Object.fromEntries((st.fields || []).map((f) => [f.name, f.values ?? f.value ?? f.text]));
const load = (extra) => call('loadMedia', { platform: 'wasmcart', path: CART, deterministicSeed: 1, deterministicStepMs: 16.6667, ...extra });

async function run(label, extra, wantGpu, wantApi) {
  const loaded = await load(extra);
  log('loaded', { label, loaded: loaded.loaded, gpu: loaded.gpu, hasWgpuRendering: loaded.capabilities?.hasWgpuRendering, gpuAdapter: loaded.gpuAdapter });
  if (!loaded.loaded || loaded.gpu !== wantGpu) fail(`${label}: loadMedia reported gpu ${JSON.stringify(loaded.gpu)}, expected ${wantGpu}`);
  const conf = await call('wasm', { op: 'conformance' });
  if (conf.conforms !== true) fail(`${label}: wasm conformance: ${JSON.stringify(conf.issues)}`);
  log('conformance', { label, conforms: conf.conforms, abi: conf.abi, warnings: (conf.issues || []).map((i) => i.code) });
  const step = await call('frame', { op: 'step', frames: 59 });
  const st = stateOf(await call('wasm', { op: 'debugState' }));
  log('state', { label, frameCount: step.frameCount, ticks: st['lit.ticks'], 'cw.gpu.api': st['cw.gpu.api'], 'cw.gpu.errors': st['cw.gpu.errors'], missing: st['cw.three.missing'] });
  writeFileSync(join(OUT, `${label}-f60.json`), `${JSON.stringify(st)}\n`);
  await call('frame', { op: 'screenshot', path: join(OUT, `${label}-f60.png`) });
  if (st['cw.gpu.api'] !== wantApi) fail(`${label}: cw.gpu.api ${st['cw.gpu.api']}, expected ${wantApi}`);
  if ((st['cw.gpu.errors'] ?? 0) !== 0) fail(`${label}: cw.gpu.errors ${st['cw.gpu.errors']}`);
  if (st['cw.three.missing'] !== 0) fail(`${label}: cw.three.missing ${st['cw.three.missing']}`);
  if (st['lit.ticks'] !== step.frameCount) fail(`${label}: lit.ticks ${st['lit.ticks']} differs from frameCount ${step.frameCount}`);
}

try {
  const health = await (await fetch(`${BASE}/healthz`)).json();
  log('romdev', health);
  await run('dual-webgpu', { wgpu: true }, 'webgpu', 2);
  await run('dual-gl', { wgpu: false }, 'gl', 1);
  if (!process.argv.includes('--no-live')) {
    const loaded = await load({ wgpu: true });
    log('live-loaded', { gpu: loaded.gpu });
    const play = await call('host', { op: 'play', seconds: LIVE_SECONDS });
    log('live-play', { ...play, startedAt: new Date().toISOString() });
    await sleep((LIVE_SECONDS + 2) * 1000);
  }
  log('done');
} catch (e) {
  log('failed', { message: e.message });
  process.exitCode = 1;
} finally {
  await call('host', { op: 'shutdown' }).catch(() => {});
}
