// Controls of the cross-host gates: each runs the gate's predicates (games/spike/tests/gate-strict.mjs: image
// gt16, exact whitelisted state, cumulative cw.three.missing) on a deliberately broken input and requires the
// predicates it must trip to fail and the others to stay green. Runs on the two-player scenario of
// tests/gates.json (spike-2p-<host>), native as reference, on romdev and Chromium.
//
//   CW_PROJECT_ROOT=<repo> CW_TEST_GPU=desktop node games/spike/tests/controls.mjs [--out <dir>] [--hosts romdev,chromium]
//
//   base                 unmodified run: all three predicates green
//   row-removed          REAL cart built with the program row `standard+l1000` removed: missing fails, state green
//   blank                the host's frame replaced by a black frame: image fails, state and missing green
//   wrong-colour-space   the host's frame with sRGB decoded as linear / encoded twice: image fails, state and missing green
//   zero-size-frame      the host's frame replaced by a 0x0 PNG: image rejected, state and missing green
//   non-finite           a whitelisted field non-finite / missing in the host's state, or non-finite in the reference
//                        state: state rejects, image and missing green
//   input-shift          REAL run with player 1's input one tick late: state fails naming spike.pos, the first
//                        divergent whitelisted field
//   tick-only            native vs native with only the HUD TICK line from the next frame: image stays green
// "REAL" controls are a new build or a new run; the others alter the artifacts of a real run.
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readImage, writePng } from '../../../deps/cartwheel-engine/tools/lib/png.mjs';
import { readState, verdict } from './gate-strict.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PROJ = process.env.CW_PROJECT_ROOT ? resolve(process.env.CW_PROJECT_ROOT) : REPO;
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const OUT = resolve(opt('--out', join(PROJ, 'out', 'controls')));
const HOSTS = opt('--hosts', 'romdev,chromium').split(',');
mkdirSync(OUT, { recursive: true });

const gates = JSON.parse(readFileSync(join(PROJ, 'tests', 'gates.json'), 'utf8'));
const gateFor = (h) => gates.find((g) => g.name === `spike-2p-${h}`);
const TICK_BOX = { x: 16, y: 56, w: 224, h: 48 };

function run(host, { app = 'spike', frames, input, tag, cart }) {
  const shot = join(OUT, `${tag}.png`), state = join(OUT, `${tag}.json`);
  return new Promise((res, rej) => {
    const p = spawn('node', [join(REPO, 'deps/cartwheel-engine/tools/run-cart.mjs'), '--host', host, '--app', app, '--frames', String(frames),
      '--input', input, '--shot', shot, '--state', state, ...(cart ? ['--cart', cart] : [])], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CW_PROJECT_ROOT: PROJ } });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => (code ? rej(new Error(`${tag}: ${host} exit ${code}: ${err.trim().split('\n').slice(-2).join(' | ')}`)) : res({ shot, state })));
  });
}

const copy = (im) => ({ w: im.w, h: im.h, rgba: Uint8Array.from(im.rgba) });
const dec = (c) => { const v = c / 255; return 255 * (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); };
const enc = (c) => { const v = c / 255; return 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055); };
const recolor = (im, f) => { const o = copy(im); for (let i = 0; i < o.w * o.h; i++) for (let k = 0; k < 3; k++) o.rgba[4 * i + k] = Math.round(f(o.rgba[4 * i + k])); return o; };
const blank = (im) => { const o = copy(im); for (let i = 0; i < o.w * o.h; i++) o.rgba.set([0, 0, 0, 255], 4 * i); return o; };
const pasteTick = (im, next) => {
  const o = copy(im);
  for (let y = TICK_BOX.y; y < TICK_BOX.y + TICK_BOX.h; y++)
    for (let x = TICK_BOX.x; x < TICK_BOX.x + TICK_BOX.w; x++) o.rgba.set(next.rgba.subarray(4 * (y * next.w + x), 4 * (y * next.w + x) + 4), 4 * (y * o.w + x));
  return o;
};
const save = (name, im) => { const f = join(OUT, name); writePng(f, im.w, im.h, im.rgba); return f; };
const saveState = (name, st) => { const f = join(OUT, name); writeFileSync(f, JSON.stringify(st) + '\n'); return f; };

/** the input script with pad2's presses one frame later */
function shiftPad2(script) {
  const at = (f) => script.filter((e) => e.frame <= f).at(-1) || {};
  const last = script.at(-1).frame + 1;
  const out = []; let prev = '';
  for (let f = 1; f <= last; f++) {
    const buttons = at(f).buttons || [], pad2 = f === 1 ? [] : (at(f - 1).pad2 || { buttons: [] }).buttons || [];
    const k = JSON.stringify([buttons, pad2]);
    if (k !== prev) { out.push({ frame: f, buttons, pad2: { buttons: pad2 } }); prev = k; }
  }
  return out;
}

/** a cart built with the program row `standard+l1000` removed from the manifest and its generated tables */
function norowCart() {
  const cart = join(OUT, 'build-cart-norow', 'carts', 'spike.wasc');
  if (existsSync(cart)) return cart;
  const progs = join(OUT, 'norow-programs');
  mkdirSync(progs, { recursive: true });
  for (const f of readdirSync(join(REPO, 'games/spike/programs'))) copyFileSync(join(REPO, 'games/spike/programs', f), join(progs, f));
  const manifest = readFileSync(join(progs, 'spike.txt'), 'utf8').split('\n').filter((l) => l.trim() !== 'standard+l1000').join('\n');
  if (manifest.includes('standard+l1000')) throw new Error('row not removed');
  writeFileSync(join(progs, 'spike.txt'), manifest);
  const sdk = join(REPO, 'deps/cartwheel-sdk');
  const sh = (cmd, args) => { const r = spawnSync(cmd, args, { encoding: 'utf8' }); if (r.status) throw new Error(`${cmd} ${args.slice(0, 3).join(' ')}: ${(r.stderr || r.stdout).split('\n').slice(-4).join(' | ')}`); };
  sh('node', [join(REPO, 'deps/cartwheel-engine/tools/programs.mjs'), '--table', join(progs, 'spike.txt'), '--build', join(REPO, 'build/native')]);
  const b = join(OUT, 'build-cart-norow');
  sh('cmake', ['-S', REPO, '-B', b, '-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release', `-DCMAKE_TOOLCHAIN_FILE=${sdk}/cart/cmake/cart.cmake`,
    `-Dcartwheel_DIR=${sdk}/cart/lib/cmake/cartwheel`, `-DCW_CWPACK=${sdk}/macos-arm64/bin/cwpack`, `-DSPIKE_PROGRAMS=${join(progs, 'spike.txt')}`]);
  sh('ninja', ['-C', b, 'spike']);
  return cart;
}

const results = [];
function check(id, host, v, expect) {
  const state = (l) => (l.length ? 'fail' : 'pass');
  const got = { image: state(v.image), state: state(v.state), missing: state(v.missing) };
  const bad = Object.entries(expect).filter(([k, want]) => k !== 'firstDivergent' && want !== 'any' && got[k] !== want).map(([k, want]) => `${k} ${got[k]}, expected ${want}`);
  if (expect.firstDivergent !== undefined && v.firstDivergent !== expect.firstDivergent) bad.push(`first divergent field ${v.firstDivergent}, expected ${expect.firstDivergent}`);
  const line = `${bad.length ? 'FAIL' : 'ok  '} ${id} [${host}] image=${got.image}${v.gt16 != null ? ` (gt16 ${v.gt16.toFixed(6)})` : ''} state=${got.state} missing=${got.missing}` +
    `${v.firstDivergent ? ` firstDivergent=${v.firstDivergent}` : ''}${bad.length ? `  <- ${bad.join('; ')}` : ''}`;
  console.log(line);
  for (const k of ['image', 'state', 'missing']) for (const p of v[k].slice(0, 2)) console.log(`       ${k}: ${p}`);
  results.push({ id, host, ok: !bad.length, got, gt16: v.gt16 ?? null, firstDivergent: v.firstDivergent, problems: { image: v.image, state: v.state, missing: v.missing } });
}

const g0 = gateFor(HOSTS[0]);
const input = join(PROJ, 'tests', g0.input), frames = g0.frames;
const script = JSON.parse(readFileSync(input, 'utf8'));
const shifted = join(OUT, 'input-2p-p1-late.json');
writeFileSync(shifted, JSON.stringify(shiftPad2(script)) + '\n');

const [native, late] = await Promise.all([run('native', { frames, input, tag: 'native' }), run('native', { frames: frames + 1, input, tag: 'native-late' })]);
const ns = readState(native.state).state;
const NAT = { refShot: native.shot, refState: ns };

// tick-counter-only change: not an image control, it must pass
{
  const f = save('native-tick-only.png', pasteTick(readImage(native.shot), readImage(late.shot)));
  check('tick-only', 'native', verdict({ ...NAT, shot: f, state: ns, fields: g0.fields, maxGt16: g0.maxGt16 }), { image: 'pass', state: 'pass', missing: 'pass' });
}

for (const h of HOSTS) {
  const g = gateFor(h);
  const V = (o) => verdict({ ...NAT, fields: g.fields, maxGt16: g.maxGt16, ...o });
  const base = await run(h, { frames, input, tag: `${h}-base` });
  const hs = readState(base.state).state, him = readImage(base.shot);
  check('base', h, V({ shot: base.shot, state: hs }), { image: 'pass', state: 'pass', missing: 'pass' });

  check('blank', h, V({ shot: save(`${h}-blank.png`, blank(him)), state: hs }), { image: 'fail', state: 'pass', missing: 'pass' });
  check('wrong-colour-space/decoded-as-linear', h, V({ shot: save(`${h}-cs-dec.png`, recolor(him, dec)), state: hs }), { image: 'fail', state: 'pass', missing: 'pass' });
  check('wrong-colour-space/encoded-twice', h, V({ shot: save(`${h}-cs-enc.png`, recolor(him, enc)), state: hs }), { image: 'fail', state: 'pass', missing: 'pass' });
  check('zero-size-frame', h, V({ shot: save(`${h}-0x0.png`, { w: 0, h: 0, rgba: new Uint8Array(0) }), state: hs }), { image: 'fail', state: 'pass', missing: 'pass' });

  const withField = (st, f, v) => ({ ...st, [f]: v });
  const without = (st, f) => { const o = { ...st }; delete o[f]; return o; };
  const jump = [...hs['spike.jump']];
  check('non-finite/null-in-array (JSON of NaN)', h, V({ shot: base.shot, state: saveStateRead(`${h}-nan-null.json`, withField(hs, 'spike.jump', jump.map((x, i) => (i === 0 ? null : x)))) }), { image: 'pass', state: 'fail', missing: 'pass' });
  check('non-finite/string', h, V({ shot: base.shot, state: saveStateRead(`${h}-nan-str.json`, withField(hs, 'spike.pos', hs['spike.pos'].map((x, i) => (i === 3 ? 'NaN' : x)))) }), { image: 'pass', state: 'fail', missing: 'pass' });
  check('non-finite/scalar-null', h, V({ shot: base.shot, state: saveStateRead(`${h}-nan-scalar.json`, withField(hs, 'spike.checksum', null)) }), { image: 'pass', state: 'fail', missing: 'pass' });
  check('non-finite/field-missing', h, V({ shot: base.shot, state: saveStateRead(`${h}-missing.json`, without(hs, 'spike.rng')) }), { image: 'pass', state: 'fail', missing: 'pass' });
  check('non-finite/reference', h, verdict({ refShot: native.shot, refState: withField(ns, 'spike.jump', jump.map((x, i) => (i === 0 ? null : x))), shot: base.shot, state: hs, fields: g.fields, maxGt16: g.maxGt16 }),
    { image: 'pass', state: 'fail', missing: 'pass' });

  const rs = await run(h, { frames, input: shifted, tag: `${h}-shift` });
  check('input-shift/player-1-one-tick-late', h, V({ shot: rs.shot, state: readState(rs.state).state }), { image: 'any', state: 'fail', missing: 'pass', firstDivergent: 'spike.pos' });

  const nr = await run(h, { frames, input, tag: `${h}-norow`, cart: norowCart() });
  check('row-removed/standard+l1000', h, V({ shot: nr.shot, state: readState(nr.state).state }), { image: 'any', state: 'pass', missing: 'fail' });
}

function saveStateRead(name, st) { return readState(saveState(name, st)).state; }

writeFileSync(join(OUT, 'controls.json'), JSON.stringify(results, null, 2) + '\n');
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `FAIL ${failed.length} of ${results.length} controls did not behave as required` : `ok   ${results.length} controls each failed exactly the predicates they must`);
process.exit(failed.length ? 1 : 0);
