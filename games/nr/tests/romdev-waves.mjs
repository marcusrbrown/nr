// romdev run of the four-wave script: the cart-wgpu nr cart on WebGPU, one `x-romdev-session` (nr-unit6) carrying every call.
//
//   node games/nr/tests/romdev-waves.mjs [--out out/unit6/romdev] [--native-state out/unit6/sim/waves-t2700.json]
//       [--live-seconds 120] [--no-live] [--live-only]
//
// 1. loadMedia with wgpu:true (gpu must be "webgpu"), wasm{conformance} must pass.
// 2. The script's entries are played as input{sequence} steps, counting the frame loadMedia already ran (the script's
//    frame 1 is that frame; docs/solutions/logic-errors/romdev-loadmedia-consumes-frame-one-2026-10-24.md). Screenshots at
//    ticks 450, 990, 1600 and 2050 on the way; at tick 2700 a screenshot and the debug state, whose whole nr.* whitelist
//    (every actor, the rng, lives, wave, camera, input count, the event log, the checksum) must equal the native state of
//    the same tick, with cw.gpu.api 2 and cw.three.missing 0.
// 3. The self-play: loadMedia again, `wasm write nr.demo 2` so the cart's bot plays both players (the street starts over
//    at that point), 2600 frames; the same whitelist must equal the native nr_bot state of tick 2600 (run here).
// 4. Unless --no-live: loadMedia again, nr.demo set to 2, and host{play} runs the self-play in real time for
//    --live-seconds so it shows on the /livestream (waves 1 and 2 begin 1 s and 6 s in; the run goes on through all four
//    and starts again after a rest). The session is left alive. --live-only runs only this step.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeWgpu } from './capture-lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };

const BASE = process.env.ROMDEV_URL || 'http://localhost:7331';
const SESSION = 'nr-unit6';
const OUT = resolve(ROOT, opt('out', 'out/unit6/romdev'));
const NATIVE = resolve(ROOT, opt('native-state', 'out/unit6/sim/waves-t2700.json'));
const DEMO_FRAMES = 2600; // the bot's run clears wave 4 at tick 2374 and starts the street again after a rest (BOT_REST in main.c)
const LIVE_SECONDS = +opt('live-seconds', 120);
const FRAMES = 2700;
const CART = resolve(ROOT, 'build/cart-wgpu/carts/nr_waves.wasc');
const SCRIPT = JSON.parse(readFileSync(join(ROOT, 'games/nr/tests/input-waves.json'), 'utf8'));
const SHOTS = [450, 990, 1600, 2050];
mkdirSync(OUT, { recursive: true });

const log = (event, data = {}) => console.log(JSON.stringify({ event, ...data }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { throw new Error(msg); };

async function call(tool, body) {
  const r = await fetch(`${BASE}/tool/${tool}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-romdev-session': SESSION }, body: JSON.stringify(body) });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  appendFileSync(join(OUT, 'calls.ndjson'), `${JSON.stringify({ at: new Date().toISOString(), tool, body: JSON.stringify(body).length > 4000 ? { op: body.op, steps: body.steps?.length } : body, status: r.status, response: text.length > 3000 ? `${text.slice(0, 3000)}…` : json })}\n`);
  if (!r.ok || json.isError || json.error) fail(`romdev ${tool}${body.op ? `.${body.op}` : ''}: HTTP ${r.status}: ${String(json.error || text).slice(0, 500)}`);
  return json;
}
const stateOf = (st) => Object.fromEntries((st.fields || []).map((f) => [f.name, f.values ?? f.value ?? f.text]));
const load = () => call('loadMedia', { platform: 'wasmcart', path: CART, wgpu: true, deterministicSeed: 1, deterministicStepMs: 16.6667 });
const pad = (buttons) => Object.fromEntries((buttons || []).map((b) => [b, true]));

/** [{input:{ports}, frames}] for engine frames from..to: the script's entry state at each frame (frame 1 ran in loadMedia). */
function steps(from, to) {
  const out = [];
  for (let f = from; f <= to; f++) {
    let e = SCRIPT[0];
    for (const s of SCRIPT) if (s.frame <= f) e = s;
    const ports = [pad(e.buttons), pad(e.pad2?.buttons)];
    const last = out[out.length - 1];
    if (last && JSON.stringify(last.input.ports) === JSON.stringify(ports)) last.frames++;
    else out.push({ input: { ports }, frames: 1 });
  }
  return out;
}

const whitelist = (st) => Object.fromEntries(Object.entries(st).filter(([k]) => k.startsWith('nr.') && !['nr.px', 'nr.demo', 'nr.bot_log', 'nr.bot_log_count'].includes(k)));
function compare(label, st, native) {
  const a = whitelist(st), b = whitelist(native);
  const diff = Object.keys(b).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  log(label, { ticks: st['nr.ticks'], checksum: st['nr.checksum'], nativeChecksum: native['nr.checksum'], fields: Object.keys(b).length, differing: diff, 'cw.gpu.api': st['cw.gpu.api'], 'cw.gpu.errors': st['cw.gpu.errors'], missing: st['cw.three.missing'] });
  if (diff.length) fail(`${label}: romdev state differs from the native state in ${diff.join(', ')}`);
  if (st['cw.gpu.api'] !== 2) fail(`${label}: cw.gpu.api ${st['cw.gpu.api']}, expected 2`);
  if ((st['cw.gpu.errors'] ?? 0) !== 0) fail(`${label}: cw.gpu.errors ${st['cw.gpu.errors']}`);
  if (st['cw.three.missing'] !== 0) fail(`${label}: cw.three.missing ${st['cw.three.missing']}`);
}

try {
  log('romdev', await (await fetch(`${BASE}/healthz`)).json());
  const native = JSON.parse(readFileSync(NATIVE, 'utf8'));
  if (!process.argv.includes('--live-only')) {
    const loaded = await load();
    log('loaded', { loaded: loaded.loaded, gpu: loaded.gpu, gpuAdapter: loaded.gpuAdapter });
    if (!loaded.loaded || loaded.gpu !== 'webgpu') fail(`loadMedia reported gpu ${JSON.stringify(loaded.gpu)}`);
    const conf = await call('wasm', { op: 'conformance' });
    if (conf.conforms !== true) fail(`wasm conformance: ${JSON.stringify(conf.issues)}`);
    log('conformance', { conforms: conf.conforms, abi: conf.abi });

    let at = 1; // engine frames run so far: loadMedia ran frame 1
    for (const stop of [...SHOTS, FRAMES]) {
      const seq = await call('input', { op: 'sequence', steps: steps(at + 1, stop) });
      at = stop;
      const ticks = stateOf(await call('wasm', { op: 'debugState' }))['nr.ticks'];
      if (ticks !== stop) fail(`nr.ticks is ${ticks} at frame ${stop} (frameCount ${seq.frameCount})`);
      await call('frame', { op: 'screenshot', path: join(OUT, `waves-f${stop}.png`) });
      log('screenshot', { tick: stop });
    }
    const st = stateOf(await call('wasm', { op: 'debugState' }));
    writeFileSync(join(OUT, `waves-f${FRAMES}.json`), `${JSON.stringify(st)}\n`);
    compare('script-state', st, native);

    const again = await load();
    log('demo-loaded', { gpu: again.gpu });
    await call('wasm', { op: 'write', name: 'nr.demo', value: 2 });
    await call('input', { op: 'sequence', steps: [{ input: { ports: [{}, {}] }, frames: DEMO_FRAMES }] });
    const dst = stateOf(await call('wasm', { op: 'debugState' }));
    writeFileSync(join(OUT, `demo-f${DEMO_FRAMES}.json`), `${JSON.stringify(dst)}\n`);
    await call('frame', { op: 'screenshot', path: join(OUT, `demo-f${DEMO_FRAMES}.png`) });
    if (dst['nr.demo'] !== 2) fail(`nr.demo is ${dst['nr.demo']}`);
    const nb = join(OUT, `native-bot-f${DEMO_FRAMES}`), rn = nativeWgpu('nr_bot', nb, DEMO_FRAMES, { inputDir: join(OUT, 'input') });
    if (rn.status !== 0) fail(`native nr_bot: ${(rn.stderr || rn.stdout || '').slice(-300)}`);
    compare('demo-state', dst, JSON.parse(readFileSync(`${nb}.json`, 'utf8')));
  }

  if (!process.argv.includes('--no-live')) {
    const live = await load();
    log('live-loaded', { gpu: live.gpu });
    await call('wasm', { op: 'write', name: 'nr.demo', value: 2 });
    const play = await call('host', { op: 'play', seconds: LIVE_SECONDS });
    log('live-play', { ...play, startedAt: new Date().toISOString(), seconds: LIVE_SECONDS });
  }
  log('done');
} catch (e) {
  log('failed', { message: e.message });
  process.exitCode = 1;
}
