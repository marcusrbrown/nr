// Row-removal controls of the program tables: proves that each `l0400` row of games/nr/programs/nr.txt is reached by
// the stage, by building `nr` natively without that row and expecting exactly that state in cw.three.missing_states.
//
//   node games/nr/tests/programs-controls.mjs [--out out/unit2/controls]
//
// For each row in the manifest (and for the full manifest as the baseline) it writes <out>/<variant>/nr.txt, generates
// the tables beside it with the engine's programs.mjs (--table, against the native build tree's capture cache), builds
// the `nr` target in <out>/<variant>/build with -DNR_PROGRAMS=<that manifest>, and runs it on the engine's fixed clock.
//   baseline         cw.three.missing == 0
//   without <row>    cw.three.missing == 1 and the one state is <row>
// The instanced row (instbig) is reached only when actors that share a frame batch into one instanced draw; the
// non-instanced row by an actor drawn alone on its frame; the plain `standard+l0400` row by the stage's ground and wall.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const OUT = resolve(ROOT, opt('out', 'out/unit2/controls'));
const SDK = join(ROOT, 'deps/cartwheel-sdk');
const env = { ...process.env, CW_PROJECT_ROOT: ROOT, CW_TEST_GPU: process.env.CW_TEST_GPU || 'desktop' };

const sh = (cmd, args, extra = {}) => {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', env, ...extra });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')}: exit ${r.status}\n${(r.stderr || r.stdout).slice(-1500)}`);
  return r;
};

const rows = readFileSync(join(ROOT, 'games/nr/programs/nr.txt'), 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#')).map((l) => l.trim());
const variants = [{ name: 'baseline', keep: rows, removed: null }, ...rows.map((r) => ({ name: `without-${r.replace(/[^a-z0-9]+/g, '-')}`, keep: rows.filter((x) => x !== r), removed: r }))];

let failed = 0;
const results = [];
for (const v of variants) {
  const dir = join(OUT, v.name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'nr.txt'), `# program table control: ${v.name}\n${v.keep.join('\n')}\n`);
  sh('node', ['deps/cartwheel-engine/tools/programs.mjs', '--table', join(dir, 'nr.txt'), '--build', 'build/native']);
  const build = join(dir, 'build');
  sh('cmake', ['-S', ROOT, '-B', build, '-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release', `-Dcartwheel_DIR=${SDK}/macos-arm64/lib/cmake/cartwheel`, `-DNR_PROGRAMS=${join(dir, 'nr.txt')}`]);
  sh('ninja', ['-C', build, 'nr']);
  const state = join(dir, 'state.json');
  sh('node', ['deps/cartwheel-engine/tools/run-cart.mjs', '--host', 'native', '--app', 'nr', '--exe', join(build, 'games/nr/nr'), '--frames', '60', '--state', state, '--input', 'games/nr/tests/input-idle.json']);
  const st = JSON.parse(readFileSync(state, 'utf8'));
  const missing = Buffer.from(st['cw.three.missing_states'], 'hex').toString().replace(/\0+$/, '').split('\n').filter(Boolean);
  const ok = v.removed === null ? st['cw.three.missing'] === 0 : st['cw.three.missing'] === 1 && missing.length === 1 && missing[0] === v.removed;
  results.push({ variant: v.name, removed: v.removed, missing: st['cw.three.missing'], states: missing, ok });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${v.name}: cw.three.missing ${st['cw.three.missing']} ${JSON.stringify(missing)}`);
  if (!ok) failed++;
}
writeFileSync(join(OUT, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
console.log(failed ? `${failed} control(s) failed` : 'all controls passed');
process.exit(failed ? 1 : 0);
