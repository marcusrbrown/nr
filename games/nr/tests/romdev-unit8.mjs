// romdev run of the full game on the dual cart (build/cart-wgpu/carts/nr.wasc), one `x-romdev-session` (nr-unit8) carrying every
// call, GL and WebGPU.
//
//   node games/nr/tests/romdev-unit8.mjs [--out out/unit8/romdev] [--publish docs/evidence/combat-slice/romdev]
//
// For each API (loadMedia wgpu:false, which the host reports as gpu "gl", then wgpu:true, "webgpu"):
//   1. loadMedia, wasm{conformance} must pass; the wasm heap size at the title.
//   2. input-2p-full.json (title, both pads join, four waves, clear) is played as input{sequence} steps, counting the frame
//      loadMedia already ran (docs/solutions/logic-errors/romdev-loadmedia-consumes-frame-one-2026-10-24.md): after each stop
//      nr.ticks must equal the engine frame count. A screenshot at each screen (the title at tick 30, the join, the fight, the
//      upgrade screen, the clear screen). At tick 2164 the state is held to the committed golden of the script and at tick
//      2300 its nr.* whitelist must equal the native binary's state of that tick on the same API, byte for byte; on WebGPU
//      cw.gpu.api must be 2 with no WebGPU errors; cw.three.missing 0.
// The session ends with the cart loaded on the title (WebGPU), nothing playing: host{op:play} is never called.
import { appendFileSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { nativeWgpu } from './capture-lib.mjs';
import { brawlerProblems, readGoldens, SCRIPTS } from './brawler.mjs';
import { romdevCall, sequenceSteps, stateOf } from './hosts-lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const BASE = process.env.ROMDEV_URL || 'http://localhost:7331';
const SESSION = 'nr-unit8';
const OUT = resolve(ROOT, opt('out', 'out/unit8/romdev'));
const PUBLISH = opt('publish') ? resolve(ROOT, opt('publish')) : null;
const CART = resolve(ROOT, 'build/cart-wgpu/carts/nr.wasc');
const SCRIPT_ID = '2p-full';
const SCRIPT = JSON.parse(readFileSync(join(ROOT, SCRIPTS.find((s) => s.id === SCRIPT_ID).input), 'utf8'));
const GOLDEN_TICK = SCRIPTS.find((s) => s.id === SCRIPT_ID).frames; // 2164, the tick the arena is cleared
const FRAMES = 2300;
const SHOTS = [30, 61, 500, 765, 1000, GOLDEN_TICK, 2250]; // title, both joined and the fight begun, a wave, the upgrade screen, the HUD, the clear screen, the clear screen later
mkdirSync(OUT, { recursive: true });

const log = (event, data = {}) => { const l = JSON.stringify({ event, ...data }); console.log(l); appendFileSync(join(OUT, 'events.ndjson'), `${l}\n`); };
const fail = (msg) => { throw new Error(msg); };
const call = async (tool, body) => {
  const j = await romdevCall(SESSION, tool, body);
  appendFileSync(join(OUT, 'calls.ndjson'), `${JSON.stringify({ at: new Date().toISOString(), tool, op: body.op, status: 'ok', response: JSON.stringify(j).slice(0, 600) })}\n`);
  return j;
};
async function heapBytes() {
  try { await romdevCall(SESSION, 'wasm', { op: 'read', offset: 4_000_000_000, length: 1 }); } catch (e) {
    const m = /past the (\d+)-byte WASM heap/.exec(e.message); if (m) return +m[1];
  }
  return null;
}
const whitelist = (st) => Object.fromEntries(Object.entries(st).filter(([k]) => k.startsWith('nr.') && !['nr.px', 'nr.demo', 'nr.bot_log', 'nr.bot_log_count', 'nr.sfx_played', 'nr.voice_created', 'nr.ui_atlas_pages', 'nr.ui_glyphs_missing'].includes(k)));
function compare(label, st, native) {
  const a = whitelist(st), b = whitelist(native);
  const diff = Object.keys(b).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  log(label, { ticks: st['nr.ticks'], checksum: st['nr.checksum'], nativeChecksum: native['nr.checksum'], fields: Object.keys(b).length, differing: diff, 'cw.gpu.api': st['cw.gpu.api'], 'cw.gpu.errors': st['cw.gpu.errors'], missing: st['cw.three.missing'] });
  if (diff.length) fail(`${label}: romdev state differs from the native state in ${diff.join(', ')}`);
  if (st['cw.three.missing'] !== 0) fail(`${label}: cw.three.missing ${st['cw.three.missing']}`);
}
const nativeGl = (frames, base) => {
  const r = spawnSync('node', ['deps/cartwheel-engine/tools/run-cart.mjs', '--host', 'native', '--app', 'nr', '--frames', String(frames), '--input', join(ROOT, SCRIPTS.find((s) => s.id === SCRIPT_ID).input), '--state', `${base}.json`, '--shot', `${base}.png`, '--gpu', 'gl'],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, CW_PROJECT_ROOT: ROOT, CW_TEST_GPU: process.env.CW_TEST_GPU || 'desktop' } });
  if (r.status !== 0) fail(`native GL run: ${(r.stderr || r.stdout).slice(-300)}`);
  return JSON.parse(readFileSync(`${base}.json`, 'utf8'));
};
const nativeW = (frames, base) => {
  const r = nativeWgpu('nr', base, frames, { input: SCRIPTS.find((s) => s.id === SCRIPT_ID).input, inputDir: join(OUT, 'input') });
  if (r.status !== 0) fail(`native WebGPU run: ${(r.stderr || r.stdout || '').slice(-300)}`);
  return JSON.parse(readFileSync(`${base}.json`, 'utf8'));
};

const summary = { session: SESSION, cart: CART, startedAt: new Date().toISOString(), apis: {} };
try {
  log('romdev', await (await fetch(`${BASE}/healthz`)).json());
  for (const api of ['gl', 'webgpu']) {
    const wgpu = api === 'webgpu';
    const tag = api === 'gl' ? 'gl' : 'wgpu';
    const native = wgpu ? nativeW(FRAMES, join(OUT, 'native-wgpu')) : nativeGl(FRAMES, join(OUT, 'native-gl'));
    const nativeGolden = wgpu ? nativeW(GOLDEN_TICK, join(OUT, 'native-wgpu-golden')) : nativeGl(GOLDEN_TICK, join(OUT, 'native-gl-golden'));
    const loaded = await call('loadMedia', { platform: 'wasmcart', path: CART, wgpu, deterministicSeed: 1, deterministicStepMs: 16.6667 });
    log('loaded', { api, loaded: loaded.loaded, gpu: loaded.gpu, gpuAdapter: loaded.gpuAdapter });
    if (!loaded.loaded || loaded.gpu !== (wgpu ? 'webgpu' : 'gl')) fail(`loadMedia reported gpu ${JSON.stringify(loaded.gpu)} for ${api}`);
    const conf = await call('wasm', { op: 'conformance' });
    if (conf.conforms !== true) fail(`wasm conformance: ${JSON.stringify(conf.issues)}`);
    const heapTitle = await heapBytes();
    log('conformance', { api, conforms: conf.conforms, abi: conf.abi, heapBytesAtTitle: heapTitle });

    const stops = [];
    let at = 1; // engine frames run so far: loadMedia ran frame 1
    let golden = null;
    for (const stop of [...SHOTS, FRAMES]) {
      const seq = await call('input', { op: 'sequence', steps: sequenceSteps(SCRIPT, at + 1, stop) });
      at = stop;
      const st = stateOf(await call('wasm', { op: 'debugState' }));
      if (st['nr.ticks'] !== stop) fail(`${api}: nr.ticks is ${st['nr.ticks']} at frame ${stop} (frameCount ${seq.frameCount})`);
      const shot = join(OUT, `${tag}-f${stop}.png`);
      await call('frame', { op: 'screenshot', path: shot });
      stops.push({ tick: stop, phase: st['nr.phase'], wave: st['nr.wave'], lives: st['nr.lives'], players: st['nr.players'], checksum: st['nr.checksum'], shot: `${tag}-f${stop}.png` });
      log('stop', { api, tick: stop, phase: st['nr.phase'], wave: st['nr.wave'], checksum: st['nr.checksum'] });
      if (stop === GOLDEN_TICK) {
        golden = brawlerProblems(SCRIPT_ID, st, readGoldens());
        log('golden', { api, tick: stop, checksum: st['nr.checksum'], problems: golden });
        if (golden.length) fail(`${api}: state at tick ${stop} is not the committed golden: ${golden.join('; ')}`);
        compare(`${api}-state-f${stop}`, st, nativeGolden);
        if (wgpu && (st['cw.gpu.api'] !== 2 || (st['cw.gpu.errors'] ?? 0) !== 0)) fail(`cw.gpu.api ${st['cw.gpu.api']} errors ${st['cw.gpu.errors']}`);
      }
    }
    const st = stateOf(await call('wasm', { op: 'debugState' }));
    writeFileSync(join(OUT, `${tag}-state-f${FRAMES}.json`), `${JSON.stringify(st)}\n`);
    compare(`${api}-state-f${FRAMES}`, st, native);
    if (wgpu && (st['cw.gpu.api'] !== 2 || (st['cw.gpu.errors'] ?? 0) !== 0)) fail(`cw.gpu.api ${st['cw.gpu.api']} errors ${st['cw.gpu.errors']}`);
    const heapEnd = await heapBytes();
    summary.apis[api] = { gpu: loaded.gpu, adapter: loaded.gpuAdapter, conformance: conf.conforms, heapBytes: { atTitle: heapTitle, afterRun: heapEnd }, goldenAt: GOLDEN_TICK, goldenProblems: golden, stateEqualToNative: { [FRAMES]: true, [GOLDEN_TICK]: true },
      checksumAt2300: st['nr.checksum'], 'cw.gpu.api': st['cw.gpu.api'], 'cw.three.missing': st['cw.three.missing'], stops };
  }
  // the session is left on the title with nothing playing
  const rest = await call('loadMedia', { platform: 'wasmcart', path: CART, wgpu: true, deterministicSeed: 1, deterministicStepMs: 16.6667 });
  const title = stateOf(await call('wasm', { op: 'debugState' }));
  await call('frame', { op: 'screenshot', path: join(OUT, 'left-at-title.png') });
  summary.leftAt = { gpu: rest.gpu, phase: title['nr.phase'], ticks: title['nr.ticks'], players: title['nr.players'], demo: title['nr.demo'], at: new Date().toISOString() };
  log('left-at-title', summary.leftAt);
  summary.ok = true;
  log('done');
} catch (e) {
  summary.ok = false;
  summary.error = e.message;
  log('failed', { message: e.message });
  process.exitCode = 1;
}
writeFileSync(join(OUT, 'session-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
if (PUBLISH) {
  mkdirSync(PUBLISH, { recursive: true });
  for (const f of ['session-summary.json', 'events.ndjson', 'left-at-title.png', 'gl-state-f2300.json', 'wgpu-state-f2300.json']) copyFileSync(join(OUT, f), join(PUBLISH, f));
  for (const api of ['gl', 'wgpu']) for (const s of SHOTS) copyFileSync(join(OUT, `${api}-f${s}.png`), join(PUBLISH, `${api}-f${s}.png`));
}
