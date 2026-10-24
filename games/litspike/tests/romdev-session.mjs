// Scripted romdev session for litspike. One `x-romdev-session` (nr-litspike) carries every call.
//
//   node games/litspike/tests/romdev-session.mjs [--out out/litspike/romdev] [--live-seconds 60] [--no-live]
//
// 1. live: loadMedia of the GL cart (deterministicStepMs 16.6667, deterministicSeed 1) and host{play} for
//    --live-seconds, so the run shows on the /livestream; no call is made on the session while it plays.
// 2. evidence: loadMedia again (a fresh run), wasm{conformance}, then frame{step} to ticks 60, 120, 180 and 240.
//    At each, `lit.ticks` is read and asserted equal to the frame count (the load runs engine frame 1), then
//    frame{screenshot} and wasm{debugState} are saved as romdev-f<N>.png / romdev-f<N>.json, the layout
//    lit-side-check.mjs reads.
// 3. WebGPU: loadMedia of the dual (GL + WebGPU) cart with wgpu:true; the response, and `cw.gpu.api` after one
//    frame, record which API romdev actually ran it on.
//
// Every response is appended to <out>/calls.ndjson. No process of this script opens a window.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const flag = (k) => argv.includes('--' + k);

const BASE = process.env.ROMDEV_URL || 'http://localhost:7331';
const SESSION = 'nr-litspike';
const PINNED_VERSION = '0.150.2';
const OUT = resolve(ROOT, opt('out', 'out/litspike/romdev'));
const LIVE_SECONDS = +opt('live-seconds', 60);
const GL_CART = resolve(ROOT, 'build/cart/carts/litspike.wasc');
const DUAL_CART = resolve(ROOT, 'out/litspike/build-cart-wgpu/carts/litspike.wasc');
const FRAMES = [60, 120, 180, 240];
mkdirSync(OUT, { recursive: true });

const log = (event, data = {}) => console.log(JSON.stringify({ event, ...data }));
class SessionError extends Error {}
class SchemaDrift extends SessionError {}
class TickMismatch extends SessionError {}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// the tool shapes this script relies on (romdev 0.150.2): params name -> JSON-schema type, ops in the `op` enum
const EXPECT = {
  loadMedia: { params: { platform: 'string', path: 'string', deterministicStepMs: 'number', deterministicSeed: 'number', wgpu: 'boolean' } },
  wasm: { ops: ['conformance', 'read', 'debugState'], params: { op: 'string', name: 'string' } },
  frame: { ops: ['step', 'screenshot'], params: { op: 'string', frames: 'number', path: 'string' } },
  host: { ops: ['shutdown', 'play'], params: { op: 'string', seconds: 'number' } },
};
const typeOk = (want, got) => got === want || (want === 'number' && got === 'integer');

async function get(path) {
  const r = await fetch(BASE + path);
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* text */ }
  return { status: r.status, text, json };
}

/** one tool call under the one session; the response is appended to calls.ndjson; throws on a non-2xx or error body */
async function call(tool, body) {
  const r = await fetch(`${BASE}/tool/${tool}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-romdev-session': SESSION }, body: JSON.stringify(body) });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  appendFileSync(join(OUT, 'calls.ndjson'), JSON.stringify({ at: new Date().toISOString(), tool, body: { ...body, base64: undefined }, status: r.status, response: text.length > 20000 ? text.slice(0, 20000) + '…' : json }) + '\n');
  if (!r.ok || json.isError || json.error) throw new SessionError(`romdev ${tool}${body.op ? '.' + body.op : ''}: HTTP ${r.status}: ${String(json.error || text).slice(0, 500)}`);
  return json;
}

async function preflight() {
  const health = await get('/healthz');
  if (!health.json || health.json.ok !== true) throw new SessionError(`romdev ${BASE}/healthz did not answer ok: ${health.text.slice(0, 200)}`);
  if (health.json.version !== PINNED_VERSION) throw new SchemaDrift(`romdev is ${health.json.version}, the pinned host version is ${PINNED_VERSION}`);
  for (const [tool, expect] of Object.entries(EXPECT)) {
    const s = await get(`/tool/${tool}/schema`);
    if (s.status !== 200 || !s.json || !s.json.properties) throw new SchemaDrift(`/tool/${tool}/schema answered HTTP ${s.status}`);
    for (const [name, type] of Object.entries(expect.params)) {
      const p = s.json.properties[name];
      if (!p) throw new SchemaDrift(`tool "${tool}" has no parameter "${name}"`);
      if (!typeOk(type, p.type)) throw new SchemaDrift(`tool "${tool}" parameter "${name}" is ${JSON.stringify(p.type)}, the script sends ${type}`);
    }
    for (const op of expect.ops || []) if (!s.json.properties.op?.enum?.includes(op)) throw new SchemaDrift(`tool "${tool}" has no op "${op}"`);
    if (s.json.additionalProperties !== false) throw new SchemaDrift(`tool "${tool}" accepts unknown parameters: a mistyped parameter would be ignored`);
  }
  log('schema-ok', { version: health.json.version, tools: Object.keys(EXPECT), sessionsAtStart: health.json.sessions });
}

const load = (path, extra = {}) => call('loadMedia', { platform: 'wasmcart', path, deterministicSeed: 1, deterministicStepMs: 16.6667, ...extra });
const stateOf = (st) => Object.fromEntries((st.fields || []).map((f) => [f.name, f.values ?? f.value ?? f.text]));
const ticksOf = async () => { const t = await call('wasm', { op: 'read', name: 'lit.ticks' }); return t.value ?? (t.values && t.values[0]); };

async function live() {
  const loaded = await load(GL_CART);
  log('live-loaded', { path: loaded.path, gpu: loaded.gpu });
  const play = await call('host', { op: 'play', seconds: LIVE_SECONDS });
  log('live-play', { ...play, startedAt: new Date().toISOString() });
  await sleep((LIVE_SECONDS + 2) * 1000); // any other call on this session ends the run
}

async function evidence() {
  const loaded = await load(GL_CART);
  if (!loaded.loaded || loaded.gpu !== 'gl') throw new SessionError(`loadMedia: loaded=${loaded.loaded} gpu=${loaded.gpu}`);
  log('loaded', { fb: [loaded.fbWidth, loaded.fbHeight], gpu: loaded.gpu, seed: loaded.deterministicSeed });
  const conf = await call('wasm', { op: 'conformance' });
  if (conf.conforms !== true) throw new SessionError(`wasm conformance: ${JSON.stringify(conf.issues)}`);
  log('conformance', { conforms: conf.conforms, abi: conf.abi, warnings: (conf.issues || []).map((i) => i.code) });

  let frameCount = 1; // the load's frame
  const results = [];
  for (const target of FRAMES) {
    const step = await call('frame', { op: 'step', frames: target - frameCount });
    frameCount = step.frameCount;
    const ticks = await ticksOf();
    log('ticks', { expected: target, got: ticks, frameCount });
    if (ticks !== target || frameCount !== target) throw new TickMismatch(`tick mismatch: lit.ticks ${ticks}, frameCount ${frameCount}, expected ${target}`);
    const shot = join(OUT, `romdev-f${target}.png`);
    await call('frame', { op: 'screenshot', path: shot });
    const state = stateOf(await call('wasm', { op: 'debugState' }));
    writeFileSync(join(OUT, `romdev-f${target}.json`), JSON.stringify(state) + '\n');
    log('captured', { frame: target, shot, checksum: state['lit.checksum'], missing: state['cw.three.missing'], missingStates: state['cw.three.missing_states'] ? Buffer.from(state['cw.three.missing_states'], 'hex').toString().replace(/\0+$/, '') : '' });
    results.push({ frame: target, checksum: state['lit.checksum'], missing: state['cw.three.missing'] });
    if (state['cw.three.missing'] !== 0) throw new SessionError(`cw.three.missing is ${state['cw.three.missing']} at frame ${target}`);
  }
  return results;
}

async function webgpu() {
  const loaded = await load(DUAL_CART, { wgpu: true });
  log('webgpu-load', { loaded: loaded.loaded, gpu: loaded.gpu, hasWgpuRendering: loaded.capabilities?.hasWgpuRendering, gpuAdapter: loaded.gpuAdapter });
  await call('frame', { op: 'step', frames: 59 });
  const st = stateOf(await call('wasm', { op: 'debugState' }));
  log('webgpu-ran-on', { 'cw.gpu.api': st['cw.gpu.api'], 'cw.gpu.errors': st['cw.gpu.errors'], ticks: st['lit.ticks'], missing: st['cw.three.missing'] });
  writeFileSync(join(OUT, 'romdev-dual-wgpu-request-f60.json'), JSON.stringify(st) + '\n');
  await call('frame', { op: 'screenshot', path: join(OUT, 'romdev-dual-wgpu-request-f60.png') });
  return { requestedWgpu: true, gpu: loaded.gpu, api: st['cw.gpu.api'] };
}

try {
  await preflight();
  if (!flag('no-live')) await live();
  const ev = await evidence();
  const wg = await webgpu();
  log('done', { evidence: ev, webgpu: wg });
} catch (e) {
  log('failed', { kind: e.constructor.name, message: e.message });
  process.exitCode = 1;
} finally {
  await call('host', { op: 'shutdown' }).catch(() => {});
}
