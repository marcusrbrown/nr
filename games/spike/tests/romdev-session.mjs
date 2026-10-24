// Scripted romdev session for the spike: load the cart deterministically, check conformance, drive two ports
// from games/spike/tests/input-2p.json, advance to the final frame, assert the tick count, then capture the
// screenshot and the named debug state and compare the whitelisted simulation state to a native run of the same input.
//
//   CW_TEST_GPU=desktop node games/spike/tests/romdev-session.mjs [--frames 300] [--out docs/evidence/shipping-path-spike]
//   ... --prove no-session-header | no-load-adjust | schema-drift   an error path; exits 0 only when the failure is detected
//   ... --live                                                       host{play} on spike_stress.wasc for the /livestream,
//                                                                    then romdev's playtest{open}, recorded and closed with playtest{stop}
//
// The script launches no process of its own that opens a window; the only window is romdev's playtest window.
//
// One `x-romdev-session` (nr-unit6) carries every call. Before any call that matters, the script reads
// /openapi.json and /tool/{name}/schema for each tool it uses and stops when a parameter, operation or type it
// relies on is not there.
//
// Frame accounting: romdev's loadMedia runs engine frame 1 (frameCount 1). input{sequence} then runs the frames of
// its steps and reports frameCount; frame{step} runs the rest. The cart ticks once per frame, so the final
// `spike.ticks` must equal the requested frame count; it is read with wasm{read} and asserted before any
// screenshot or debugState call.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const flag = (k) => argv.includes('--' + k);

const BASE = process.env.ROMDEV_URL || 'http://localhost:7331';
const SESSION = 'nr-unit6';
const PINNED_VERSION = '0.150.2';
const FRAMES = +opt('frames', 300);
const OUT = resolve(ROOT, opt('out', 'docs/evidence/shipping-path-spike'));
const INPUT = resolve(ROOT, opt('input', 'games/spike/tests/input-2p.json'));
const CART = resolve(ROOT, 'build/cart/carts/spike.wasc');
const STRESS_CART = resolve(ROOT, 'build/cart/carts/spike_stress.wasc');
const PROVE = opt('prove', null);

const log = (event, data = {}) => console.log(JSON.stringify({ event, ...data }));
class SessionError extends Error {}
class SchemaDrift extends SessionError {}
class TickMismatch extends SessionError {}

// ── the tool shapes this script relies on (romdev 0.150.2) ─────────────
// params: name -> JSON-schema type ('number' accepts integer); ops: operations that must be in the `op` enum
const EXPECT = {
  loadMedia: { params: { platform: 'string', path: 'string', deterministicStepMs: 'number', deterministicSeed: 'number' } },
  wasm: { ops: ['conformance', 'read', 'debugState', 'info'], params: { op: 'string', name: 'string', offset: 'number', length: 'number' } },
  input: { ops: ['sequence'], params: { op: 'string', steps: 'array' }, describes: 'input:{ports' },
  frame: { ops: ['step', 'screenshot'], params: { op: 'string', frames: 'number', path: 'string' } },
  host: { ops: ['shutdown', 'play'], params: { op: 'string', seconds: 'number' } },
  playtest: { ops: ['open', 'stop', 'status'], params: { op: 'string' } },
};

function typeOk(want, got) { return got === want || (want === 'number' && got === 'integer'); }

/** throws SchemaDrift naming the tool, the parameter and what differs */
function checkSchema(tool, schema, expect = EXPECT[tool]) {
  const fail = (m) => { throw new SchemaDrift(`schema drift: tool "${tool}" ${m} (pinned romdev ${PINNED_VERSION})`); };
  if (!schema || schema.type !== 'object' || !schema.properties) fail('has no object schema');
  for (const [name, type] of Object.entries(expect.params)) {
    const p = schema.properties[name];
    if (!p) fail(`has no parameter "${name}"`);
    if (!typeOk(type, p.type)) fail(`parameter "${name}" is type ${JSON.stringify(p.type)}, the script sends ${type}`);
  }
  for (const op of expect.ops || []) {
    const en = schema.properties.op && schema.properties.op.enum;
    if (!en || !en.includes(op)) fail(`has no op "${op}" (op enum: ${JSON.stringify(en)})`);
  }
  if (expect.describes && !String(schema.properties.steps?.description || '').includes(expect.describes))
    fail(`parameter "steps" no longer describes the step shape ${expect.describes}…`);
  if (schema.additionalProperties !== false) fail('accepts unknown parameters (additionalProperties is not false): a mistyped parameter would be ignored');
}

async function get(path) {
  const r = await fetch(BASE + path);
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* text */ }
  return { status: r.status, text, json };
}

/** one tool call; throws with the server's message on a non-2xx or an error body */
async function call(tool, body, { session = SESSION } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (session) headers['x-romdev-session'] = session;
  const r = await fetch(`${BASE}/tool/${tool}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!r.ok || json.isError || json.error) {
    const e = new SessionError(`romdev ${tool}${body.op ? '.' + body.op : ''}: HTTP ${r.status}: ${String(json.error || text).slice(0, 500)}`);
    e.status = r.status;
    e.body = json;
    throw e;
  }
  return json;
}

async function preflight({ expect = EXPECT } = {}) {
  const health = await get('/healthz');
  if (!health.json || health.json.ok !== true) throw new SessionError(`romdev ${BASE}/healthz did not answer ok: ${health.text.slice(0, 200)}`);
  if (health.json.version !== PINNED_VERSION) throw new SchemaDrift(`romdev is ${health.json.version}, the pinned host version is ${PINNED_VERSION}`);
  const oa = await get('/openapi.json');
  if (!oa.json || !oa.json.paths) throw new SchemaDrift('/openapi.json has no paths');
  const tools = Object.keys(expect);
  for (const t of tools) if (!oa.json.paths[`/tool/${t}`]) throw new SchemaDrift(`/openapi.json has no /tool/${t}`);
  const checked = [];
  for (const t of tools) {
    const s = await get(`/tool/${t}/schema`);
    if (s.status !== 200 || !s.json) throw new SchemaDrift(`/tool/${t}/schema answered HTTP ${s.status}`);
    checkSchema(t, s.json, expect[t]);
    checked.push(t);
  }
  log('schema-ok', { version: health.json.version, tools: checked, sessionsAtStart: health.json.sessions });
  return health.json;
}

// ── input: input-2p.json -> romdev sequence steps ──────────────────────
const padOf = (s) => Object.fromEntries((s?.buttons || []).map((b) => [b === 'back' ? 'select' : b, true]));
const isNeutral = (e) => !(e.buttons || []).length && !(e.pad2?.buttons || []).length;

/** Steps for entries[0..n-1] given that frames 1..`done` have run. Every entry but the last runs its span; the
 *  last entry runs one frame, so the rest of the run is a plain frame{step} with that (neutral) input held. */
function planSequence(script, done) {
  const steps = [];
  for (let i = 0; i < script.length; i++) {
    const e = script[i];
    const start = Math.max(e.frame, done + 1);
    const last = i === script.length - 1;
    const end = last ? start + 1 : script[i + 1].frame;
    const frames = end - start;
    if (frames > 0) steps.push({ input: { ports: [padOf(e), padOf(e.pad2)] }, frames });
  }
  return steps;
}

// ── native reference ───────────────────────────────────────────────────
function nativeReference(frames, input, outDir) {
  const state = join(outDir, 'state-native.json');
  const shot = join(outDir, 'shot-native.png');
  const r = spawnSync('node', ['deps/cartwheel-engine/tools/run-cart.mjs', '--host', 'native', '--app', 'spike', '--frames', String(frames),
    '--input', input, '--shot', shot, '--state', state], { cwd: ROOT, encoding: 'utf8',
    env: { ...process.env, CW_PROJECT_ROOT: ROOT, CW_TEST_GPU: process.env.CW_TEST_GPU || 'desktop' } });
  if (r.status !== 0) throw new SessionError(`native reference run failed (exit ${r.status}): ${(r.stderr || r.stdout).slice(-600)}`);
  return state;
}

function whitelist(statePath) {
  const r = spawnSync('node', ['games/spike/tests/whitelist.mjs', statePath], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) throw new SessionError(`whitelist ${statePath}: ${r.stderr.trim()}`);
  return r.stdout.trim();
}

// ── the session ────────────────────────────────────────────────────────
async function session({ adjustLoadFrame = true, outDir }) {
  mkdirSync(outDir, { recursive: true });
  const script = JSON.parse(readFileSync(INPUT, 'utf8'));
  if (!isNeutral(script[0]) || script[0].frame !== 1) throw new SessionError('the input script must start with a neutral entry at frame 1 (the load runs frame 1)');
  if (!isNeutral(script[script.length - 1])) throw new SessionError('the input script must end neutral: input{sequence} releases the pad after its last step');
  if (FRAMES <= script[script.length - 1].frame) throw new SessionError(`--frames ${FRAMES} ends before the last input entry (frame ${script[script.length - 1].frame})`);

  const native = nativeReference(FRAMES, INPUT, outDir);
  log('native-reference', { state: native, frames: FRAMES });

  const loaded = await call('loadMedia', { platform: 'wasmcart', path: CART, deterministicSeed: 1, deterministicStepMs: 16.6667 });
  if (!loaded.loaded || loaded.gpu !== 'gl') throw new SessionError(`loadMedia: loaded=${loaded.loaded} gpu=${loaded.gpu}`);
  log('loaded', { path: loaded.path, fb: [loaded.fbWidth, loaded.fbHeight], gpu: loaded.gpu, seed: loaded.deterministicSeed });

  try {
    const conf = await call('wasm', { op: 'conformance' });
    if (conf.conforms !== true) throw new SessionError(`wasm conformance: conforms=${conf.conforms}: ${JSON.stringify(conf.issues)}`);
    log('conformance', { conforms: conf.conforms, abi: conf.abi, warnings: (conf.issues || []).map((i) => i.code) });

    // engine frames already run: the load's frame 1. Forgetting it is the error path "no-load-adjust".
    const done = adjustLoadFrame ? 1 : 0;
    const steps = planSequence(script, done);
    const planned = steps.reduce((n, s) => n + s.frames, 0);
    const seq = await call('input', { op: 'sequence', steps });
    if (seq.framesRun !== planned) throw new SessionError(`input sequence ran ${seq.framesRun} frames, planned ${planned}`);
    const afterSequence = seq.frameCount;
    const expectAfterSequence = 1 + planned; // the load's frame + the sequence's
    if (afterSequence !== expectAfterSequence) throw new SessionError(`frameCount after the sequence is ${afterSequence}, expected ${expectAfterSequence}`);
    const remaining = adjustLoadFrame ? FRAMES - afterSequence : FRAMES - planned;
    log('sequence', { steps: steps.length, framesRun: seq.framesRun, frameCount: afterSequence, remaining });
    const step = await call('frame', { op: 'step', frames: remaining });
    log('stepped', { framesRun: step.framesRun, frameCount: step.frameCount });

    // the tick count is checked before anything is captured or compared
    const ticks = await call('wasm', { op: 'read', name: 'spike.ticks' });
    const got = ticks.value ?? (ticks.values && ticks.values[0]);
    log('ticks', { expected: FRAMES, got, frameCount: step.frameCount });
    if (got !== FRAMES || step.frameCount !== FRAMES)
      throw new TickMismatch(`tick mismatch: spike.ticks ${got}, frameCount ${step.frameCount}, expected ${FRAMES} (the load runs frame 1; account for it and for every frame input{sequence} advanced)`);

    const shot = join(outDir, 'shot-romdev.png');
    await call('frame', { op: 'screenshot', path: shot });
    const st = await call('wasm', { op: 'debugState' });
    const state = {};
    for (const f of st.fields || []) state[f.name] = f.values ?? f.value ?? f.text;
    const statePath = join(outDir, 'state-romdev.json');
    writeFileSync(statePath, JSON.stringify(state) + '\n');

    const a = whitelist(statePath), b = whitelist(native);
    const equal = a === b;
    log('compare', { equal, whitelistBytes: a.length, checksumRomdev: state['spike.checksum'], checksumNative: JSON.parse(b)['spike.checksum'], ticks: state['spike.ticks'] });
    if (!equal) throw new SessionError('whitelisted simulation state differs from the native run of the same input');
    if (state['cw.three.missing'] !== 0) throw new SessionError(`cw.three.missing is ${state['cw.three.missing']}`);
    return { statePath, shot };
  } finally {
    await call('host', { op: 'shutdown' }).catch(() => {});
  }
}

// ── error paths ────────────────────────────────────────────────────────
async function proveNoSessionHeader() {
  const before = (await get('/healthz')).json.sessions;
  const r = await fetch(`${BASE}/tool/loadMedia`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ platform: 'wasmcart', path: CART, deterministicSeed: 1, deterministicStepMs: 16.6667 }) });
  const body = await r.json().catch(() => ({}));
  const after = (await get('/healthz')).json.sessions;
  const skill = await get('/skills/romdev/SKILL.md');
  const documented = /omit it and you get a \*\*401\*\*/.test(skill.text);
  log('no-session-header', { status: r.status, error: body.error, documentedIn: '/skills/romdev/SKILL.md', documented, sessionsBefore: before, sessionsAfter: after });
  if (r.status !== 401 || !/Missing required `x-romdev-session` header/.test(body.error || '')) throw new SessionError('a call without x-romdev-session was not refused with the documented 401');
  if (!documented) throw new SessionError('the live skill text no longer documents the 401');
  if (after !== before) throw new SessionError(`a session was created without the header (sessions ${before} -> ${after})`);
  log('proved', { error: 'missing session header -> HTTP 401 with the documented message; no session created' });
}

async function proveNoLoadAdjust(outDir) {
  const shot = join(outDir, 'shot-romdev.png');
  const before = existsSync(shot) ? readFileSync(shot).length : -1;
  let err = null;
  try { await session({ adjustLoadFrame: false, outDir }); } catch (e) { err = e; }
  if (!(err instanceof TickMismatch)) throw new SessionError(`skipping the load-frame adjustment was not caught as a tick mismatch: ${err ? err.message : 'no error'}`);
  const after = existsSync(shot) ? readFileSync(shot).length : -1;
  if (after !== before) throw new SessionError('a screenshot was written after a tick mismatch');
  log('proved', { error: err.message });
}

async function proveSchemaDrift() {
  const bad = { ...EXPECT, frame: { ...EXPECT.frame, params: { ...EXPECT.frame.params, frames: 'string' } } };
  let err = null;
  try { await preflight({ expect: bad }); } catch (e) { err = e; }
  if (!(err instanceof SchemaDrift)) throw new SessionError(`a changed expected shape was not reported as schema drift: ${err ? err.message : 'no error'}`);
  log('proved', { error: err.message });
}

// ── live preview ───────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function live() {
  const loaded = await call('loadMedia', { platform: 'wasmcart', path: STRESS_CART, deterministicSeed: 1, deterministicStepMs: 16.6667 });
  log('live-loaded', { path: loaded.path, gpu: loaded.gpu });
  const play = await call('host', { op: 'play', seconds: 60 });
  log('live-play', { ...play, startedAt: new Date().toISOString() });
  await sleep(62000); // no call on this session while it plays: any other call ends the run
  try {
    log('playtest-open', await call('playtest', { op: 'open' }));
    await sleep(20000);
    log('playtest-status', await call('playtest', { op: 'status' }));
    log('playtest-stop', await call('playtest', { op: 'stop' }));
  } catch (e) {
    log('playtest-failed', { message: e.message, body: e.body });
  } finally {
    await call('host', { op: 'shutdown' }).catch(() => {});
  }
}

// ── main ───────────────────────────────────────────────────────────────
try {
  if (PROVE === 'no-session-header') await proveNoSessionHeader();
  else if (PROVE === 'schema-drift') await proveSchemaDrift();
  else {
    await preflight();
    if (PROVE === 'no-load-adjust') await proveNoLoadAdjust(OUT);
    else if (flag('live')) await live();
    else { const r = await session({ outDir: OUT }); log('done', r); }
  }
} catch (e) {
  log('failed', { kind: e.constructor.name, message: e.message });
  process.exit(1);
}
