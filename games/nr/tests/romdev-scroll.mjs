// romdev run of the street block: the cart-wgpu nr cart on WebGPU, scrolled by two players on input-scroll.json, one
// `x-romdev-session` (nr-unit4) carrying every call.
//
//   node games/nr/tests/romdev-scroll.mjs [--out out/unit4/romdev] [--frames 640] [--native-state out/unit4/caps/scroll-f640.json] [--live-seconds 60] [--no-live]
//
// 1. loadMedia with wgpu:true (gpu must be "webgpu"), wasm{conformance} must pass.
// 2. The script's entries are played as input{sequence} steps, counting the frame loadMedia already ran (the script's frame 1
//    is that frame; docs/solutions/logic-errors/romdev-loadmedia-consumes-frame-one-2026-10-24.md), until `nr.ticks` is
//    --frames; then a screenshot and the debug state are written, and the state must equal the native state of the same
//    tick (--native-state: nr.ticks, hero positions, camera, checksum) with cw.gpu.api 2 and cw.three.missing 0.
// 3. Unless --no-live: loadMedia again, the players walk the street on a held input, and host{play} runs the scene in
//    real time for --live-seconds so it shows on the /livestream.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };

const BASE = process.env.ROMDEV_URL || 'http://localhost:7331';
const SESSION = 'nr-unit4';
const OUT = resolve(ROOT, opt('out', 'out/unit4/romdev'));
const FRAMES = +opt('frames', 640);
const NATIVE = resolve(ROOT, opt('native-state', 'out/unit4/caps/scroll-f640.json'));
const LIVE_SECONDS = +opt('live-seconds', 60);
const CART = resolve(ROOT, 'build/cart-wgpu/carts/nr.wasc');
const SCRIPT = JSON.parse(readFileSync(join(ROOT, 'games/nr/tests/input-scroll.json'), 'utf8'));
const COMPARED = ['nr.ticks', 'nr.hero_pos', 'nr.hero_clip', 'nr.hero_step', 'nr.light_pos', 'nr.light_intensity', 'nr.cam_x', 'nr.cam_left', 'nr.checksum'];
mkdirSync(OUT, { recursive: true });

const log = (event, data = {}) => console.log(JSON.stringify({ event, ...data }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { throw new Error(msg); };

async function call(tool, body) {
  const r = await fetch(`${BASE}/tool/${tool}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-romdev-session': SESSION }, body: JSON.stringify(body) });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  appendFileSync(join(OUT, 'calls.ndjson'), `${JSON.stringify({ at: new Date().toISOString(), tool, body: JSON.stringify(body).length > 4000 ? { op: body.op, steps: body.steps?.length } : body, status: r.status, response: text.length > 20000 ? `${text.slice(0, 20000)}…` : json })}\n`);
  if (!r.ok || json.isError || json.error) fail(`romdev ${tool}${body.op ? `.${body.op}` : ''}: HTTP ${r.status}: ${String(json.error || text).slice(0, 500)}`);
  return json;
}
const stateOf = (st) => Object.fromEntries((st.fields || []).map((f) => [f.name, f.values ?? f.value ?? f.text]));
const load = () => call('loadMedia', { platform: 'wasmcart', path: CART, wgpu: true, deterministicSeed: 1, deterministicStepMs: 16.6667 });
const pad = (buttons) => Object.fromEntries((buttons || []).map((b) => [b, true]));

/** [{input:{ports}, frames}] for engine frames 2..total: the script's entry state at each frame (frame 1 ran in loadMedia). */
function steps(total) {
  const out = [];
  for (let f = 2; f <= total; f++) {
    let e = SCRIPT[0];
    for (const s of SCRIPT) if (s.frame <= f) e = s;
    const ports = [pad(e.buttons), pad(e.pad2?.buttons)];
    const last = out[out.length - 1];
    if (last && JSON.stringify(last.input.ports) === JSON.stringify(ports)) last.frames++;
    else out.push({ input: { ports }, frames: 1 });
  }
  return out;
}

try {
  log('romdev', await (await fetch(`${BASE}/healthz`)).json());
  const loaded = await load();
  log('loaded', { loaded: loaded.loaded, gpu: loaded.gpu, gpuAdapter: loaded.gpuAdapter });
  if (!loaded.loaded || loaded.gpu !== 'webgpu') fail(`loadMedia reported gpu ${JSON.stringify(loaded.gpu)}`);
  const conf = await call('wasm', { op: 'conformance' });
  if (conf.conforms !== true) fail(`wasm conformance: ${JSON.stringify(conf.issues)}`);
  log('conformance', { conforms: conf.conforms, abi: conf.abi });

  const seq = await call('input', { op: 'sequence', steps: steps(FRAMES) });
  log('sequence', { framesRun: seq.framesRun, frameCount: seq.frameCount });
  const raw = await call('wasm', { op: 'debugState' });
  const st = stateOf(raw);
  if (st['nr.ticks'] !== FRAMES) fail(`nr.ticks is ${st['nr.ticks']}, expected ${FRAMES}`);
  await call('frame', { op: 'screenshot', path: join(OUT, `scroll-f${FRAMES}.png`) });
  writeFileSync(join(OUT, `scroll-f${FRAMES}.json`), `${JSON.stringify(st)}\n`);
  const native = JSON.parse(readFileSync(NATIVE, 'utf8'));
  const diff = COMPARED.filter((k) => JSON.stringify(st[k]) !== JSON.stringify(native[k]));
  log('state', { ticks: st['nr.ticks'], cam_x: st['nr.cam_x'], checksum: st['nr.checksum'], nativeChecksum: native['nr.checksum'], 'cw.gpu.api': st['cw.gpu.api'], 'cw.gpu.errors': st['cw.gpu.errors'], missing: st['cw.three.missing'], differing: diff });
  if (diff.length) fail(`romdev state differs from the native state in ${diff.join(', ')}`);
  if (st['cw.gpu.api'] !== 2) fail(`cw.gpu.api ${st['cw.gpu.api']}, expected 2`);
  if ((st['cw.gpu.errors'] ?? 0) !== 0) fail(`cw.gpu.errors ${st['cw.gpu.errors']}`);
  if (st['cw.three.missing'] !== 0) fail(`cw.three.missing ${st['cw.three.missing']}`);

  if (!process.argv.includes('--no-live')) {
    const again = await load();
    log('live-loaded', { gpu: again.gpu });
    await call('input', { op: 'sequence', steps: steps(232) }); // to the leash: the trailing player at the left edge, the leader at the soft wall
    await call('input', { op: 'set', ports: [{ right: true }, { right: true }] }); // then both walk the street on a held input
    const play = await call('host', { op: 'play', seconds: LIVE_SECONDS });
    log('live-play', { ...play, startedAt: new Date().toISOString() });
    await sleep((LIVE_SECONDS + 2) * 1000);
  }
  log('done');
} catch (e) {
  log('failed', { message: e.message });
  process.exitCode = 1;
}
