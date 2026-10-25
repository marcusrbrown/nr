// Surveys the three.c program states nr draws and regenerates the committed program tables.
//
//   node games/nr/tests/programs-survey.mjs [--apps nr,nr_lit_h,...] [--frames 120] [--input games/nr/tests/input-idle.json]
//       [--states <state.json> ...]
//
// A bare three.c renderer has no pipeline to log the program states it skipped, so the survey reads them from each
// run's published `cw.three.missing_states` (a native run of every app, plus any --states files from cart runs),
// merges them into games/nr/programs/nr.txt, and regenerates nr_gl.c / nr_wgpu.c with the engine's programs.mjs
// (--table, against the native build tree, which holds the capture cache). Rebuild afterwards; run it again until it
// reports no new state. See docs/solutions/workflow-issues/cartwheel-programs-survey-out-of-tree-2026-10-24.md.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const all = (k) => argv.flatMap((a, i) => (a === `--${k}` && argv[i + 1] ? [argv[i + 1]] : []));

const APPS = opt('apps', 'nr,nr_dummies,nr_bot,nr_arena_bare,nr_stage,nr_lit_h,nr_lit_v,nr_lit_h_flat,nr_lit_v_flat,nr_lit_h_left,nr_lit_v_left,nr_lit_h_left_flat,nr_lit_v_left_flat,nr_solo_0,nr_solo_1,nr_solo_2,nr_bare').split(',');
const FRAMES = opt('frames', '120');
const INPUT = opt('input', 'games/nr/tests/input-idle.json');
const MANIFEST = join(ROOT, 'games/nr/programs/nr.txt');
const OUT = join(ROOT, 'out/unit2/survey');
mkdirSync(OUT, { recursive: true });

const decode = (hex) => Buffer.from(hex ?? '', 'hex').toString().replace(/\0+$/, '').split('\n').map((s) => s.trim()).filter(Boolean);
const found = new Set();
const runs = [];
for (const app of APPS) {
  const state = join(OUT, `${app}.json`);
  const r = spawnSync('node', ['deps/cartwheel-engine/tools/run-cart.mjs', '--host', 'native', '--app', app, '--frames', FRAMES, '--state', state, '--input', INPUT],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, CW_PROJECT_ROOT: ROOT, CW_TEST_GPU: process.env.CW_TEST_GPU || 'desktop' } });
  if (r.status !== 0) { console.error(`${app}: run-cart exit ${r.status}\n${(r.stderr || r.stdout).slice(-600)}`); process.exit(1); }
  const states = decode(JSON.parse(readFileSync(state, 'utf8'))['cw.three.missing_states']);
  states.forEach((s) => found.add(s));
  runs.push({ app, missing: states });
}
for (const f of all('states')) decode(JSON.parse(readFileSync(resolve(ROOT, f), 'utf8'))['cw.three.missing_states']).forEach((s) => found.add(s));

const lines = readFileSync(MANIFEST, 'utf8').split('\n');
const known = new Set(lines.filter((l) => l.trim() && !l.startsWith('#')).map((l) => l.trim()));
const added = [...found].filter((s) => !known.has(s)).sort();
console.log(JSON.stringify({ runs, added }));
if (!added.length) { console.log('no new program state'); process.exit(0); }
writeFileSync(MANIFEST, `${lines.filter((l, i) => l.trim() || i < lines.length - 1).join('\n').replace(/\n+$/, '')}\n${added.join('\n')}\n`);
const g = spawnSync('node', ['deps/cartwheel-engine/tools/programs.mjs', '--table', 'games/nr/programs/nr.txt', '--build', 'build/native'],
  { cwd: ROOT, encoding: 'utf8', env: { ...process.env, CW_PROJECT_ROOT: ROOT, CW_TEST_GPU: process.env.CW_TEST_GPU || 'desktop' } });
console.log((g.stdout + g.stderr).slice(-1200));
process.exit(g.status ?? 1);
