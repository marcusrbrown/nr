// The committed golden of each brawler-gate script (games/nr/tests/goldens.json): the native binary's final checksum and the
// final state facts, from one native run of the script on GL.
//
//   CW_TEST_GPU=desktop node games/nr/tests/goldens.mjs            check: two native runs of every script give the golden
//   CW_TEST_GPU=desktop node games/nr/tests/goldens.mjs --write    run every script natively twice (equal, or no write) and write the file
//
// The golden is data a test reads, not an expectation derived from the run being tested: a change to the simulation, the
// scripts or the build that moves a checksum fails the gate until the golden is rewritten on purpose and the diff reviewed.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FINAL_FIELDS, GOLDENS, ROOT, SCRIPTS, brawlerProblems, readGoldens } from './brawler.mjs';

const OUT = join(ROOT, 'out/unit8/goldens');
mkdirSync(OUT, { recursive: true });
const write = process.argv.includes('--write');

function native(s, tag) {
  const state = join(OUT, `${s.id}-${tag}.json`);
  const r = spawnSync('node', ['deps/cartwheel-engine/tools/run-cart.mjs', '--host', 'native', '--app', s.app, '--frames', String(s.frames), '--input', s.input, '--state', state, '--shot', join(OUT, `${s.id}-${tag}.png`)],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, CW_PROJECT_ROOT: ROOT, CW_TEST_GPU: process.env.CW_TEST_GPU || 'desktop' } });
  if (r.status !== 0) throw new Error(`${s.id}: native run failed: ${(r.stderr || r.stdout).slice(-400)}`);
  return JSON.parse(readFileSync(state, 'utf8'));
}

const next = { schema: 1, note: 'native GL final state of each brawler-gate script; games/nr/tests/goldens.mjs --write regenerates it', scripts: {} };
let failed = 0;
for (const s of SCRIPTS) {
  const a = native(s, 'a'), b = native(s, 'b');
  const stable = a['nr.checksum'] === b['nr.checksum'] && FINAL_FIELDS.every((f) => JSON.stringify(a[f]) === JSON.stringify(b[f]));
  next.scripts[s.id] = { app: s.app, input: s.input, frames: s.frames, checksum: a['nr.checksum'], final: Object.fromEntries(FINAL_FIELDS.map((f) => [f, a[f]])) };
  const problems = write ? [] : brawlerProblems(s.id, a, readGoldens());
  if (write) problems.push(...brawlerProblems(s.id, a, next).filter((p) => !p.startsWith('no golden')));
  if (!stable) problems.push('two native runs differ');
  console.log(`${problems.length ? 'FAIL' : 'ok  '} ${s.id.padEnd(9)} ${s.app} ${s.frames}f checksum ${a['nr.checksum']}${problems.length ? `\n  ${problems.join('\n  ')}` : ''}`);
  if (problems.length) failed++;
}
if (write && !failed) { writeFileSync(GOLDENS, `${JSON.stringify(next, null, 2)}\n`); console.log(`wrote ${GOLDENS}`); }
process.exit(failed ? 1 : 0);
