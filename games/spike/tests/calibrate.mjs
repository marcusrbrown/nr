// Image-tolerance calibration for tests/gates.json, as predeclared in docs/evidence/shipping-path-spike/README.md.
//
//   CW_PROJECT_ROOT=<repo> CW_TEST_GPU=desktop node games/spike/tests/calibrate.mjs [--out <dir>] [--repeats 3]
//
// For every scenario (the strict entries of tests/gates.json, by app + input + frames) it runs native, romdev and
// Chromium `repeats` times, plus every host one frame early and native one frame late, then measures gt16 (the
// engine gate's metric) per host pair:
//   known good  native vs host over all pairs of repeated runs; native vs native whose only difference is the
//               TICK line of the HUD (the pixels of the next frame's TICK line pasted into this frame)
//   known bad   the host's frame blanked; the host's frame in the wrong colour space (sRGB decoded as if it were
//               linear, and encoded twice); the host one frame early
// Tolerance of a pair: 2 x max(good), floor 0.0005; accepted only if <= min(bad) / 2, else "failed to calibrate".
// Writes <out>/calibration.json and prints the table.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { diffImages, readImage } from '../../../deps/cartwheel-engine/tools/lib/png.mjs';
import { FLOOR_GT16 } from './gate-strict.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PROJ = process.env.CW_PROJECT_ROOT ? resolve(process.env.CW_PROJECT_ROOT) : REPO;
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const OUT = resolve(opt('--out', join(PROJ, 'out', 'unit45', 'calibration')));
const REPEATS = +opt('--repeats', 3);
mkdirSync(OUT, { recursive: true });

// the TICK line of the HUD (games/spike/main.c draws "TICK %d" at logical (12, 30), size 18, at 2x): pixel box
const TICK_BOX = { x: 16, y: 56, w: 224, h: 48 };

const gates = JSON.parse(readFileSync(join(PROJ, 'tests', 'gates.json'), 'utf8')).filter((g) => g.strict);
const scenarios = [...new Map(gates.map((g) => [`${g.app}|${g.input}|${g.frames}`, { app: g.app, input: g.input, frames: g.frames }])).values()];
const pairs = [...new Set(gates.map((g) => g.hosts.find((h) => h !== 'native')))];

function run(host, sc, frames, tag) {
  const shot = join(OUT, `${sc.app}-${frames}-${host}-${tag}.png`), state = join(OUT, `${sc.app}-${frames}-${host}-${tag}.json`);
  return new Promise((res, rej) => {
    const p = spawn('node', [join(REPO, 'deps/cartwheel-engine/tools/run-cart.mjs'), '--host', host, '--app', sc.app, '--frames', String(frames),
      '--input', join(PROJ, 'tests', sc.input), '--shot', shot, '--state', state], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CW_PROJECT_ROOT: PROJ } });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => (code ? rej(new Error(`${host} ${sc.app} ${frames}: exit ${code}: ${err.trim().split('\n').slice(-2).join(' | ')}`)) : res({ shot, state })));
  });
}

const img = (f) => {
  const im = readImage(f);
  if (!(im.w > 0 && im.h > 0)) throw new Error(`${f}: ${im.w}x${im.h} frame`);
  return im;
};
const gt16 = (a, b) => { const d = diffImages(a, b); if (!d.comparable || !Number.isFinite(d.gt16)) throw new Error(`not comparable: ${d.reason}`); return d.gt16; };
const copy = (im) => ({ w: im.w, h: im.h, rgba: Uint8Array.from(im.rgba) });
const blank = (im) => { const o = copy(im); for (let i = 0; i < o.w * o.h; i++) o.rgba.set([0, 0, 0, 255], 4 * i); return o; };
const dec = (c) => { const v = c / 255; return 255 * (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); };
const enc = (c) => { const v = c / 255; return 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055); };
const recolor = (im, f) => { const o = copy(im); for (let i = 0; i < o.w * o.h; i++) for (let k = 0; k < 3; k++) o.rgba[4 * i + k] = Math.round(f(o.rgba[4 * i + k])); return o; };
const pasteTick = (im, next) => {
  const o = copy(im);
  for (let y = TICK_BOX.y; y < TICK_BOX.y + TICK_BOX.h; y++)
    for (let x = TICK_BOX.x; x < TICK_BOX.x + TICK_BOX.w; x++) o.rgba.set(next.rgba.subarray(4 * (y * next.w + x), 4 * (y * next.w + x) + 4), 4 * (y * o.w + x));
  return o;
};

const data = { generated: new Date().toISOString(), repeats: REPEATS, floor: FLOOR_GT16, scenarios: [], pairs: {} };
const sample = (list, kind, value, label) => list.push({ kind, label, gt16: value });

for (const sc of scenarios) {
  const F = sc.frames;
  const hosts = ['native', ...pairs];
  const runs = {};
  await Promise.all(hosts.map(async (h) => {
    runs[h] = [];
    for (let r = 1; r <= REPEATS; r++) runs[h].push(await run(h, sc, F, `r${r}`));
    runs[h].early = await run(h, sc, F - 1, 'early');
  }));
  runs.native.late = await run('native', sc, F + 1, 'late');
  const S = { app: sc.app, input: sc.input, frames: F, good: {}, bad: {}, crossHost: null };
  const nat = runs.native.map((r) => img(r.shot));
  const natLate = img(runs.native.late.shot);
  const tickOnly = gt16(nat[0], pasteTick(nat[0], natLate));
  const natNat = []; for (let i = 1; i < nat.length; i++) natNat.push(gt16(nat[0], nat[i]));
  for (const h of pairs) {
    const good = [], bad = [];
    const hi = runs[h].map((r) => img(r.shot));
    for (let i = 0; i < nat.length; i++) for (let j = 0; j < hi.length; j++) sample(good, 'host', gt16(nat[i], hi[j]), `native r${i + 1} vs ${h} r${j + 1}`);
    natNat.forEach((v, i) => sample(good, 'repeat', v, `native r1 vs native r${i + 2}`));
    sample(good, 'tick-only', tickOnly, 'native vs native with only the HUD TICK line from the next frame');
    sample(bad, 'blank', gt16(nat[0], blank(hi[0])), `native vs blank ${h}`);
    sample(bad, 'wrong-colour-space', gt16(nat[0], recolor(hi[0], dec)), `native vs ${h} with sRGB decoded as linear`);
    sample(bad, 'wrong-colour-space', gt16(nat[0], recolor(hi[0], enc)), `native vs ${h} encoded twice`);
    sample(bad, 'one-frame-early', gt16(nat[0], img(runs[h].early.shot)), `native at ${F} vs ${h} at ${F - 1}`);
    sample(bad, 'one-frame-early', gt16(nat[0], img(runs.native.early.shot)), `native at ${F} vs native at ${F - 1}`);
    S.good[h] = good; S.bad[h] = bad;
  }
  if (pairs.includes('romdev') && pairs.includes('chromium')) {
    const a = img(runs.romdev[0].shot), b = img(runs.chromium[0].shot), d = diffImages(a, b);
    S.crossHost = { gt16: d.gt16, gt2: d.gt2, any: d.any, max: d.max };
  }
  data.scenarios.push(S);
}

for (const h of pairs) {
  const good = data.scenarios.flatMap((s) => s.good[h].map((x) => ({ ...x, scenario: `${s.app}/${s.frames}` })));
  const bad = data.scenarios.flatMap((s) => s.bad[h].map((x) => ({ ...x, scenario: `${s.app}/${s.frames}` })));
  const goodMax = Math.max(...good.map((x) => x.gt16)), badMin = Math.min(...bad.map((x) => x.gt16));
  const tolerance = Math.max(2 * goodMax, FLOOR_GT16);
  const accepted = tolerance <= badMin / 2;
  const byKind = (k) => Math.min(...bad.filter((x) => x.kind === k).map((x) => x.gt16));
  data.pairs[h] = { goodMax, goodMaxOf: good.find((x) => x.gt16 === goodMax), badMin, badMinOf: bad.find((x) => x.gt16 === badMin),
    badMinByKind: { blank: byKind('blank'), 'wrong-colour-space': byKind('wrong-colour-space'), 'one-frame-early': byKind('one-frame-early') },
    tolerance, accepted, verdict: accepted ? 'calibrated' : 'failed to calibrate' };
}
writeFileSync(join(OUT, 'calibration.json'), JSON.stringify(data, null, 2) + '\n');
console.log(JSON.stringify(data.pairs, null, 2));
for (const s of data.scenarios) console.log(`${s.app} ${s.frames}f romdev-vs-chromium: ${JSON.stringify(s.crossHost)}`);
process.exit(Object.values(data.pairs).every((p) => p.accepted) ? 0 : 1);
