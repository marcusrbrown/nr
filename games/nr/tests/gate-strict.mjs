// The brawler gate's predicates on the artifacts of a run, and the tool gate that applies them to the artifacts the nr entries
// of tests/gates.json (those with "brawler": true) wrote to out/gate/ in the same gate.mjs run.
//
// On top of the engine's stock comparison (frame under the calibrated bound, exact whitelisted state, zero skipped program
// states) this rejects what that comparison lets through, with games/spike/tests/gate-strict.mjs's predicates: a whitelisted field
// missing or not finite on either side, a 0x0 or size-mismatched frame, a nonzero cumulative cw.three.missing or any state
// name in cw.three.missing_states. And it holds both the native and the host state to the committed golden of the script
// (games/nr/tests/goldens.json) and the facts the script exists to show (brawler.mjs: title to clear, wave index 4, both
// players alive).
//
//   node games/nr/tests/gate-strict.mjs        (CW_PROJECT_ROOT defaults to this repository)
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { missingProblems, readState, verdict } from '../../spike/tests/gate-strict.mjs';
import { SCRIPTS, brawlerProblems } from './brawler.mjs';

export { readState };

/** every predicate of the brawler gate on one host's artifacts: { image, state, missing, golden } each a list of problem strings */
export function nrVerdict({ id, refShot, refState, shot, state, fields, maxGt16 }) {
  const v = verdict({ refShot, refState, shot, state, fields, maxGt16 });
  v.golden = brawlerProblems(id, state);
  v.namesPublished = state['cw.three.missing_states'] !== undefined; // run-cart's romdev host does not carry byte fields
  return v;
}

/** the script of a gates.json entry named nr-<id>-<host> */
export const scriptOf = (gate) => SCRIPTS.find((s) => gate.name.startsWith(`${s.gate}-`));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const REPO = resolve(fileURLToPath(import.meta.url), '../../../..');
  const PROJ = process.env.CW_PROJECT_ROOT ? resolve(process.env.CW_PROJECT_ROOT) : REPO;
  const OUT = join(PROJ, 'out', 'gate');
  const gates = JSON.parse(readFileSync(join(PROJ, 'tests', 'gates.json'), 'utf8')).filter((g) => g.brawler);
  let failed = 0;
  for (const g of gates) {
    const host = g.hosts.find((h) => h !== 'native');
    const p = (h, ext) => join(OUT, `${g.name}.${h}.${ext}`);
    const problems = [];
    const sc = scriptOf(g);
    const need = [p('native', 'png'), p('native', 'json'), p(host, 'png'), p(host, 'json')];
    const absent = need.filter((f) => !existsSync(f));
    if (!sc) problems.push(`${g.name}: no script of that name in brawler.mjs`);
    else if (g.frames !== sc.frames) problems.push(`gate runs ${g.frames} frames, the script is ${sc.frames}`);
    if (absent.length) problems.push(`artifacts missing (run the nr entries first, in the same gate.mjs invocation): ${absent.join(', ')}`);
    else if (sc) {
      const rs = readState(p('native', 'json')), gs = readState(p(host, 'json'));
      if (rs.reject || gs.reject) problems.push(rs.reject || gs.reject);
      else {
        const v = nrVerdict({ id: sc.id, refShot: p('native', 'png'), refState: rs.state, shot: p(host, 'png'), state: gs.state, fields: g.fields, maxGt16: g.maxGt16 });
        problems.push(...v.image.map((x) => `image: ${x}`), ...v.state.map((x) => `state: ${x}`), ...v.missing.map((x) => `missing: ${x}`), ...v.golden.map((x) => `golden: ${x}`));
        for (const m of missingProblems(rs.state)) problems.push(`native missing: ${m}`);
        for (const m of brawlerProblems(sc.id, rs.state)) problems.push(`native golden: ${m}`);
      }
    }
    if (problems.length) { failed++; console.log(`FAIL ${g.name}\n  ${problems.join('\n  ')}`); } else console.log(`ok   ${g.name} (native vs ${host}, golden ${sc.id})`);
  }
  if (!gates.length) { console.log('FAIL no brawler entries in tests/gates.json'); failed++; }
  process.exit(failed ? 1 : 0);
}
