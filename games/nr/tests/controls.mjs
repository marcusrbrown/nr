// Controls of the brawler gate: each runs the gate's predicates (games/nr/tests/gate-strict.mjs: image gt16 against the
// calibrated bound, exact whitelisted state, cumulative cw.three.missing, the committed golden and the script's facts) on a
// deliberately broken input and requires the predicates it must trip to fail and every other to stay green. Runs on the
// title-to-clear script (nr-2p-full), the native binary as reference on its own API, on romdev and Chromium on GL and on
// Chromium and romdev on WebGPU.
//
//   CW_TEST_GPU=desktop node games/nr/tests/controls.mjs [--out out/unit8/controls] [--hosts romdev,chromium,chromium-wgpu,romdev-wgpu]
//       [--publish <dir>]
//
//   base                 unmodified run: all four predicates green
// A control that names a program state checks the name only on hosts whose state carries cw.three.missing_states; run-cart.mjs's
// romdev host does not carry byte fields, so there the count (exactly 1, or more) is all that is checked (`namesChecked: false`).
//   row-removed          REAL cart built with the program row `standard+map+nearest+nmap+atest+l0400` (the hero planes)
//                        removed: missing fails, state, golden and image-independent predicates green
//   light-count          REAL cart built with a fifth point light (NR_EXTRA_LIGHT): the lit draws are `l0500` states with no row
//                        (three.c covers a frame with fewer lights than a row's, so a lost light changes nothing; one more has no row): missing fails
//   blank                the host's frame replaced by a black frame: image fails only
//   wrong-colour-space   the host's frame with sRGB decoded as linear / encoded twice: image fails only
//   zero-size-frame      the host's frame replaced by a 0x0 PNG: image rejected only
//   non-finite           a whitelisted field non-finite / missing in the host's state, or non-finite in the reference state:
//                        state rejects only
//   input-shift          REAL run with player 2's input one tick late: state fails (the first divergent whitelisted field is
//                        named) and golden fails (the same checksum fact against the committed value); missing stays green
//   non-whitelisted      a field outside the whitelist (the sounds this host turned into voices) altered: nothing fails
// "REAL" controls are a new build or a new run; the others alter the artifacts of a real run. The nr HUD draws no tick
// counter, so the spike's tick-counter-only image control has no counterpart; `non-whitelisted` is the state-side analogue.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readImage, writePng } from '../../../deps/cartwheel-engine/tools/lib/png.mjs';
import { ROOT, SCRIPTS } from './brawler.mjs';
import { nrVerdict, readState } from './gate-strict.mjs';
import { REFERENCE, romdevCall, runHost } from './hosts-lib.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const OUT = resolve(ROOT, opt('out', 'out/unit8/controls'));
const HOSTS = opt('hosts', 'romdev,chromium,chromium-wgpu,romdev-wgpu').split(',');
const PUBLISH = opt('publish') ? resolve(ROOT, opt('publish')) : null;
mkdirSync(OUT, { recursive: true });

const sc = SCRIPTS.find((s) => s.id === '2p-full');
const gates = JSON.parse(readFileSync(join(ROOT, 'tests/gates.json'), 'utf8'));
const glGate = (h) => gates.find((g) => g.name === `nr-2p-full-${h}`);
const calibration = JSON.parse(readFileSync(join(ROOT, 'docs/evidence/combat-slice/image-calibration.json'), 'utf8'));
const fields = glGate('romdev').fields;
const boundOf = (h) => glGate(h)?.maxGt16 ?? calibration.pairs[h].tolerance;
const SDK = join(ROOT, 'deps/cartwheel-sdk');
const WGPU = (h) => h.endsWith('-wgpu');

const copy = (im) => ({ w: im.w, h: im.h, rgba: Uint8Array.from(im.rgba) });
const dec = (c) => { const v = c / 255; return 255 * (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); };
const enc = (c) => { const v = c / 255; return 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055); };
const recolor = (im, f) => { const o = copy(im); for (let i = 0; i < o.w * o.h; i++) for (let k = 0; k < 3; k++) o.rgba[4 * i + k] = Math.round(f(o.rgba[4 * i + k])); return o; };
const blank = (im) => { const o = copy(im); for (let i = 0; i < o.w * o.h; i++) o.rgba.set([0, 0, 0, 255], 4 * i); return o; };
const save = (name, im) => { const f = join(OUT, name); writePng(f, im.w, im.h, im.rgba); return f; };
const saveState = (name, st) => { const f = join(OUT, name); writeFileSync(f, `${JSON.stringify(st)}\n`); return readState(f).state; };

/** the input script with pad 2's presses one frame later */
function shiftPad2(script) {
  const at = (f) => script.filter((e) => e.frame <= f).at(-1) || {};
  const last = script.at(-1).frame + 1;
  const out = [];
  let prev = '';
  for (let f = 1; f <= last; f++) {
    const buttons = at(f).buttons || [], pad2 = f === 1 ? [] : (at(f - 1).pad2 || { buttons: [] }).buttons || [];
    const k = JSON.stringify([buttons, pad2]);
    if (k !== prev) { out.push({ frame: f, buttons, pad2: { buttons: pad2 } }); prev = k; }
  }
  return out;
}

const sh = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', env: { ...process.env, CW_PROJECT_ROOT: ROOT, CW_TEST_GPU: 'desktop' } });
  if (r.status) throw new Error(`${cmd} ${args.slice(0, 3).join(' ')}: ${(r.stderr || r.stdout).split('\n').slice(-5).join(' | ')}`);
};
/** a cart of `app` for `target` (cart | cart-wgpu) built with extra CMake definitions; cached under OUT */
function controlCart(kind, target, defs, manifest = null) {
  const dir = join(OUT, `build-${kind}-${target}`), cart = join(dir, 'carts', `${sc.app}.wasc`);
  if (existsSync(cart)) return cart;
  const extra = [];
  if (manifest) {
    const progs = join(OUT, `programs-${kind}`);
    mkdirSync(progs, { recursive: true });
    for (const f of readdirSync(join(ROOT, 'games/nr/programs'))) copyFileSync(join(ROOT, 'games/nr/programs', f), join(progs, f));
    const rows = readFileSync(join(progs, 'nr.txt'), 'utf8').split('\n');
    const kept = rows.filter((l) => l.trim() !== manifest);
    if (kept.length === rows.length) throw new Error(`row ${manifest} not in the manifest`);
    writeFileSync(join(progs, 'nr.txt'), kept.join('\n'));
    sh('node', ['deps/cartwheel-engine/tools/programs.mjs', '--table', join(progs, 'nr.txt'), '--build', 'build/native']);
    extra.push(`-DNR_PROGRAMS=${join(progs, 'nr.txt')}`);
  }
  sh('cmake', ['-S', ROOT, '-B', dir, '-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release', `-DCMAKE_TOOLCHAIN_FILE=${SDK}/${target}/cmake/cart.cmake`,
    `-Dcartwheel_DIR=${SDK}/${target}/lib/cmake/cartwheel`, `-DCW_CWPACK=${SDK}/macos-arm64/bin/cwpack`, ...defs, ...extra]);
  sh('ninja', ['-C', dir, sc.app]);
  return cart;
}
const ROW = 'standard+map+nearest+nmap+atest+l0400';

const results = [];
function check(id, host, v, expect) {
  const st = (l) => (l.length ? 'fail' : 'pass');
  const got = { image: st(v.image), state: st(v.state), missing: st(v.missing), golden: st(v.golden) };
  const bad = Object.entries(expect).filter(([k, want]) => k !== 'firstDivergent' && k !== 'names' && want !== 'any' && got[k] !== want).map(([k, want]) => `${k} ${got[k]}, expected ${want}`);
  if (expect.firstDivergent !== undefined && v.firstDivergent !== expect.firstDivergent) bad.push(`first divergent field ${v.firstDivergent}, expected ${expect.firstDivergent}`);
  const namesChecked = !expect.names || v.namesPublished;
  if (expect.names && v.namesPublished && !v.missing.some((m) => m.includes(expect.names))) bad.push(`missing does not name ${expect.names}`);
  console.log(`${bad.length ? 'FAIL' : 'ok  '} ${id} [${host}] image=${got.image}${v.gt16 != null ? ` (gt16 ${v.gt16.toFixed(6)})` : ''} state=${got.state} missing=${got.missing} golden=${got.golden}` +
    `${v.firstDivergent ? ` firstDivergent=${v.firstDivergent}` : ''}${bad.length ? `  <- ${bad.join('; ')}` : ''}`);
  for (const k of ['image', 'state', 'missing', 'golden']) for (const p of v[k].slice(0, 2)) console.log(`       ${k}: ${p}`);
  results.push({ id, host, ok: !bad.length, namesChecked, got, gt16: v.gt16 ?? null, firstDivergent: v.firstDivergent ?? null, problems: { image: v.image, state: v.state, missing: v.missing, golden: v.golden } });
}

const shifted = join(OUT, 'input-2p-full-p2-late.json');
writeFileSync(shifted, `${JSON.stringify(shiftPad2(JSON.parse(readFileSync(join(ROOT, sc.input), 'utf8'))))}\n`);

const refRuns = {};
for (const r of new Set(HOSTS.map((h) => REFERENCE[h]))) refRuns[r] = await runHost(r, sc, sc.frames, join(OUT, r));

for (const h of HOSTS) {
  const ref = REFERENCE[h], R = refRuns[ref], rs = readState(R.state).state;
  const bound = boundOf(h);
  const V = (o) => nrVerdict({ id: sc.id, refShot: R.shot, refState: rs, fields, maxGt16: bound, ...o });
  const session = 'nr-unit8-controls';
  const base = await runHost(h, sc, sc.frames, join(OUT, `${h}-base`), { session });
  const hs = readState(base.state).state, him = readImage(base.shot);
  const PASS = { image: 'pass', state: 'pass', missing: 'pass', golden: 'pass' };
  check('base', h, V({ shot: base.shot, state: hs }), PASS);

  check('blank', h, V({ shot: save(`${h}-blank.png`, blank(him)), state: hs }), { ...PASS, image: 'fail' });
  check('wrong-colour-space/decoded-as-linear', h, V({ shot: save(`${h}-cs-dec.png`, recolor(him, dec)), state: hs }), { ...PASS, image: 'fail' });
  check('wrong-colour-space/encoded-twice', h, V({ shot: save(`${h}-cs-enc.png`, recolor(him, enc)), state: hs }), { ...PASS, image: 'fail' });
  check('zero-size-frame', h, V({ shot: save(`${h}-0x0.png`, { w: 0, h: 0, rgba: new Uint8Array(0) }), state: hs }), { ...PASS, image: 'fail' });

  const withField = (st, f, v) => ({ ...st, [f]: v });
  const without = (st, f) => { const o = { ...st }; delete o[f]; return o; };
  const NF = { ...PASS, state: 'fail' };
  check('non-finite/null-in-array (JSON of NaN)', h, V({ shot: base.shot, state: saveState(`${h}-nan-null.json`, withField(hs, 'nr.light_pos', hs['nr.light_pos'].map((x, i) => (i === 0 ? null : x)))) }), NF);
  check('non-finite/string', h, V({ shot: base.shot, state: saveState(`${h}-nan-str.json`, withField(hs, 'nr.hero_pos', hs['nr.hero_pos'].map((x, i) => (i === 3 ? 'NaN' : x)))) }), NF);
  check('non-finite/scalar-null', h, V({ shot: base.shot, state: saveState(`${h}-nan-scalar.json`, withField(hs, 'nr.cam_x', null)) }), NF);
  check('non-finite/field-missing', h, V({ shot: base.shot, state: saveState(`${h}-missing.json`, without(hs, 'nr.rng')) }), NF);
  check('non-finite/reference', h, nrVerdict({ id: sc.id, refShot: R.shot, refState: withField(rs, 'nr.hero_pos', rs['nr.hero_pos'].map((x, i) => (i === 0 ? null : x))), shot: base.shot, state: hs, fields, maxGt16: bound }), NF);
  check('non-whitelisted/voices-this-host-made', h, V({ shot: base.shot, state: saveState(`${h}-sfx.json`, withField(hs, 'nr.sfx_played', hs['nr.sfx_played'].map((x) => x + 1))) }), PASS);

  const shift = await runHost(h, { ...sc, input: shifted }, sc.frames, join(OUT, `${h}-shift`), { session, input: shifted });
  check('input-shift/player-2-one-tick-late', h, V({ shot: shift.shot, state: readState(shift.state).state }), { image: 'any', state: 'fail', golden: 'fail', missing: 'pass', firstDivergent: 'nr.hero_pos' });

  const target = WGPU(h) ? 'cart-wgpu' : 'cart';
  const norow = await runHost(h, sc, sc.frames, join(OUT, `${h}-norow`), { session, cart: controlCart('norow', target, [], ROW) });
  check(`row-removed/${ROW}`, h, V({ shot: norow.shot, state: readState(norow.state).state }), { image: 'any', state: 'pass', golden: 'pass', missing: 'fail', names: ROW });
  const morelight = await runHost(h, sc, sc.frames, join(OUT, `${h}-morelight`), { session, cart: controlCart('morelight', target, ['-DNR_EXTRA_LIGHT=ON']) });
  check('light-count-changed/five-lights', h, V({ shot: morelight.shot, state: readState(morelight.state).state }), { image: 'any', state: 'pass', golden: 'pass', missing: 'fail', names: 'l0500' });
}

await romdevCall('nr-unit8-controls', 'host', { op: 'shutdown' }).catch(() => {});
writeFileSync(join(OUT, 'controls.json'), `${JSON.stringify(results, null, 2)}\n`);
if (PUBLISH) { mkdirSync(PUBLISH, { recursive: true }); writeFileSync(join(PUBLISH, 'controls.json'), `${JSON.stringify(results, null, 2)}\n`); }
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `FAIL ${failed.length} of ${results.length} controls did not behave as required` : `ok   ${results.length} controls each failed exactly the predicates they must`);
process.exit(failed.length ? 1 : 0);
