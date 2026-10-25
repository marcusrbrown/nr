// romdev run of the look gate's combat captures on the dual cart with WebGPU (build/cart-wgpu/carts/nr_look.wasc), one
// `x-romdev-session` (nr-look) carrying every call.
//
//   node games/nr/tests/romdev-look.mjs [--out out/round2/romdev] [--publish docs/evidence/combat-slice/round2/romdev]
//
// For each combat capture of look-set.mjs (hit 2, hit 3, the radius special, the dash special): loadMedia with a deterministic clock,
// input-look.json as input{sequence} steps counting the frame loadMedia already ran, a screenshot at the capture's tick, and the debug
// state. The state's nr.* and cw.three.* fields must equal the native run's (look/<name>.json, which look-set.mjs kept), cw.three.missing
// 0 (the host's state does not carry the byte field naming the states, so `cw.three.missing_states` is not compared), cw.gpu.api 2 with no WebGPU errors, and the screenshot pixel-identical to the committed capture. The session ends with the full game
// (build/cart-wgpu/carts/nr.wasc) loaded on the title, nothing playing: host{op:play} is never called.
import { appendFileSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readImage } from './look-lib.mjs';
import { romdevCall, sequenceSteps, stateOf } from './hosts-lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const BASE = process.env.ROMDEV_URL || 'http://localhost:7331';
const SESSION = 'nr-look';
const OUT = resolve(ROOT, opt('out', 'out/round2/romdev'));
const PUBLISH = opt('publish') ? resolve(ROOT, opt('publish')) : null;
const LOOK = join(ROOT, 'docs/evidence/combat-slice/look');
const CARTS = join(ROOT, 'build/cart-wgpu/carts');
const SCRIPT = JSON.parse(readFileSync(join(ROOT, 'games/nr/tests/input-look.json'), 'utf8'));
const CAPTURES = [['combat-hit2', 264], ['combat-hit3', 280], ['combat-radius-special', 124], ['combat-dash-special', 49]];
mkdirSync(OUT, { recursive: true });

const log = (event, data = {}) => { const l = JSON.stringify({ event, ...data }); console.log(l); appendFileSync(join(OUT, 'events.ndjson'), `${l}\n`); };
const fail = (msg) => { throw new Error(msg); };
const call = (tool, body) => romdevCall(SESSION, tool, body);
const kept = (st) => Object.fromEntries(Object.entries(st).filter(([k]) => /^(nr\.|cw\.three\.|cw\.gpu\.)/.test(k) && !/^nr\.(bot_log|perf)/.test(k)));
const differing = (a, b) => { const x = kept(a), y = kept(b); return Object.keys(y).filter((k) => !/^nr\.(px|demo|sfx_played|voice_created|ui_atlas_pages)|^cw\.three\.missing_states$/.test(k) && JSON.stringify(x[k]) !== JSON.stringify(y[k])); };
function pixelsDiffering(a, b) {
  const A = readImage(a), B = readImage(b);
  if (A.w !== B.w || A.h !== B.h) return -1;
  let n = 0;
  for (let i = 0; i < A.w * A.h * 4; i += 4) if (A.rgba[i] !== B.rgba[i] || A.rgba[i + 1] !== B.rgba[i + 1] || A.rgba[i + 2] !== B.rgba[i + 2] || A.rgba[i + 3] !== B.rgba[i + 3]) n++;
  return n;
}

const summary = { session: SESSION, startedAt: new Date().toISOString(), captures: [] };
try {
  log('romdev', await (await fetch(`${BASE}/healthz`)).json());
  for (const [name, tick] of CAPTURES) {
    const loaded = await call('loadMedia', { platform: 'wasmcart', path: join(CARTS, 'nr_look.wasc'), wgpu: true, deterministicSeed: 1, deterministicStepMs: 16.6667 });
    if (!loaded.loaded || loaded.gpu !== 'webgpu') fail(`loadMedia reported gpu ${JSON.stringify(loaded.gpu)}`);
    await call('input', { op: 'sequence', steps: sequenceSteps(SCRIPT, 2, tick) });
    const shot = join(OUT, `${name}.png`);
    await call('frame', { op: 'screenshot', path: shot });
    const st = stateOf(await call('wasm', { op: 'debugState' }));
    writeFileSync(join(OUT, `${name}.json`), `${JSON.stringify(kept(st))}\n`);
    const native = JSON.parse(readFileSync(join(LOOK, `${name}.json`), 'utf8'));
    const diff = differing(st, native), px = pixelsDiffering(shot, join(LOOK, `${name}.png`));
    const row = { name, tick, ticks: st['nr.ticks'], checksum: st['nr.checksum'], differingFields: diff, differingPixels: px, missing: st['cw.three.missing'], 'cw.gpu.api': st['cw.gpu.api'], 'cw.gpu.errors': st['cw.gpu.errors'] ?? 0, adapter: loaded.gpuAdapter };
    summary.captures.push(row);
    log('capture', row);
    if (st['nr.ticks'] !== tick) fail(`${name}: nr.ticks ${st['nr.ticks']}, not ${tick}`);
    if (diff.length) fail(`${name}: state differs from native in ${diff.join(', ')}`);
    if (px !== 0) fail(`${name}: ${px} pixels differ from the committed capture`);
    if (st['cw.three.missing'] !== 0 || st['cw.gpu.api'] !== 2 || (st['cw.gpu.errors'] ?? 0) !== 0) fail(`${name}: missing ${st['cw.three.missing']}, gpu api ${st['cw.gpu.api']}, errors ${st['cw.gpu.errors']}`);
  }
  // the session is left on the title with nothing playing
  const rest = await call('loadMedia', { platform: 'wasmcart', path: join(CARTS, 'nr.wasc'), wgpu: true, deterministicSeed: 1, deterministicStepMs: 16.6667 });
  const title = stateOf(await call('wasm', { op: 'debugState' }));
  await call('frame', { op: 'screenshot', path: join(OUT, 'left-at-title.png') });
  summary.leftAt = { gpu: rest.gpu, phase: title['nr.phase'], ticks: title['nr.ticks'], players: title['nr.players'], demo: title['nr.demo'], at: new Date().toISOString() };
  log('left-at-title', summary.leftAt);
  summary.ok = true;
} catch (e) {
  summary.ok = false;
  summary.error = e.message;
  log('failed', { message: e.message });
  process.exitCode = 1;
}
writeFileSync(join(OUT, 'session-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
if (PUBLISH && summary.ok) {
  mkdirSync(PUBLISH, { recursive: true });
  for (const f of ['session-summary.json', 'events.ndjson', 'left-at-title.png', ...CAPTURES.map(([n]) => `${n}.png`)]) copyFileSync(join(OUT, f), join(PUBLISH, f));
}
