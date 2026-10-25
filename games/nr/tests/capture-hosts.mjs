// The brawler gate's WebGPU legs: each script of games/nr/tests/brawler.mjs on the native binary on WebGPU (Dawn on Metal, SDL's
// offscreen driver) and on the dual cart (build/cart-wgpu) in headless Chromium and on romdev (loadMedia wgpu:true), because
// run-cart.mjs --gpu webgpu reads a Linux test-GPU pin that has no macOS equivalent. Each host is held to the native WebGPU run
// by the predicates of games/nr/tests/gate-strict.mjs (exact whitelisted state, frame under the bound calibrated for the pair in
// docs/evidence/combat-slice/image-calibration.json, no skipped program state, the committed golden and the script's facts),
// and every run reports WebGPU as its API (cw.gpu.api 2) with no WebGPU errors.
// Control: the native WebGPU run one frame short must fail the state predicate against the full run, or the leg proves nothing.
//
//   CW_TEST_GPU=desktop node games/nr/tests/capture-hosts.mjs [--scripts 2p-full,waves] [--hosts chromium-wgpu,romdev-wgpu]
//       [--out out/gate/wgpu] [--calibration docs/evidence/combat-slice/image-calibration.json] [--publish <dir>]
//
// romdev is one session (nr-unit8-gate) shut down at the end. --publish writes the last frame of every host's run and a result
// file there.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { diffImages, readImage } from '../../../deps/cartwheel-engine/tools/lib/png.mjs';
import { ROOT, SCRIPTS } from './brawler.mjs';
import { nrVerdict, readState } from './gate-strict.mjs';
import { REFERENCE, romdevCall, runHost } from './hosts-lib.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const OUT = resolve(ROOT, opt('out', 'out/gate/wgpu'));
const HOSTS = opt('hosts', 'chromium-wgpu,romdev-wgpu').split(',');
const ONLY = opt('scripts') ? opt('scripts').split(',') : SCRIPTS.map((s) => s.id);
const CAL = resolve(ROOT, opt('calibration', 'docs/evidence/combat-slice/image-calibration.json'));
const PUBLISH = opt('publish') ? resolve(ROOT, opt('publish')) : null;
mkdirSync(OUT, { recursive: true });

const gates = JSON.parse(readFileSync(join(ROOT, 'tests/gates.json'), 'utf8'));
const calibration = (() => { try { return JSON.parse(readFileSync(CAL, 'utf8')); } catch { return null; } })();
const SESSION = 'nr-unit8-gate';

let failed = 0;
const results = [];
for (const id of ONLY) {
  const sc = SCRIPTS.find((s) => s.id === id);
  const g = gates.find((e) => e.name === `${sc.gate}-romdev`); // the entry that carries the whitelist
  const problems = [];
  const base = (h, k = '') => join(OUT, `${sc.gate}.${h}${k}`);
  let rows = {};
  try {
    const nat = await runHost('native-wgpu', sc, sc.frames, base('native-wgpu'));
    const hosts = {};
    await Promise.all(HOSTS.map(async (h) => { hosts[h] = await runHost(h, sc, sc.frames, base(h), { session: SESSION }); }));
    const ns = readState(nat.state).state;
    for (const h of HOSTS) {
      const pair = calibration?.pairs?.[h];
      if (!pair || !pair.accepted) { problems.push(`${h}: no accepted calibration for this pair in ${CAL}`); continue; }
      const gs = readState(hosts[h].state).state;
      const v = nrVerdict({ id, refShot: nat.shot, refState: ns, shot: hosts[h].shot, state: gs, fields: g.fields, maxGt16: pair.tolerance });
      const mine = [...v.image.map((x) => `image: ${x}`), ...v.state.map((x) => `state: ${x}`), ...v.missing.map((x) => `missing: ${x}`), ...v.golden.map((x) => `golden: ${x}`)];
      if (gs['cw.gpu.api'] !== 2) mine.push(`cw.gpu.api ${gs['cw.gpu.api']}, expected 2`);
      if (gs['cw.gpu.errors']) mine.push(`cw.gpu.errors ${gs['cw.gpu.errors']}`);
      problems.push(...mine.map((x) => `${h}: ${x}`));
      rows[h] = { gt16: v.gt16, tolerance: pair.tolerance, checksum: gs['nr.checksum'], missing: gs['cw.three.missing'], ms: hosts[h].ms };
    }
    for (const m of nrVerdict({ id, refShot: nat.shot, refState: ns, shot: nat.shot, state: ns, fields: g.fields, maxGt16: 1 }).golden) problems.push(`native-wgpu golden: ${m}`);
    // control: one frame short must differ in the whitelisted state
    const short = await runHost('native-wgpu', sc, sc.frames - 1, base('native-wgpu', '.control'));
    const cv = nrVerdict({ id, refShot: nat.shot, refState: ns, shot: short.shot, state: readState(short.state).state, fields: g.fields, maxGt16: 1 });
    if (!cv.state.length) problems.push('CONTROL PASSED: the WebGPU leg cannot tell a run one frame short apart');
    rows.control = { stateDiverges: cv.state.length > 0, firstDivergent: cv.firstDivergent };
    rows['native-wgpu'] = { checksum: ns['nr.checksum'], missing: ns['cw.three.missing'], ms: nat.ms };
  } catch (e) {
    problems.push(e.message);
  }
  if (problems.length) { failed++; console.log(`FAIL ${sc.gate} [wgpu]\n  ${problems.join('\n  ')}`); }
  else console.log(`ok   ${sc.gate} [wgpu] (native-wgpu, ${HOSTS.join(', ')}) ${HOSTS.map((h) => `${h} gt16 ${rows[h].gt16.toFixed(6)}`).join(', ')}; control one frame short diverges at ${rows.control.firstDivergent}`);
  results.push({ id, gate: sc.gate, app: sc.app, frames: sc.frames, ok: !problems.length, problems, rows });
}
await romdevCall(SESSION, 'host', { op: 'shutdown' }).catch(() => {});
writeFileSync(join(OUT, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
if (PUBLISH) {
  mkdirSync(PUBLISH, { recursive: true });
  writeFileSync(join(PUBLISH, 'wgpu-hosts.json'), `${JSON.stringify(results, null, 2)}\n`);
}
process.exit(failed ? 1 : 0);
