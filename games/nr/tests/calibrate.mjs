// Image-tolerance calibration of the nr gates, by the method predeclared in docs/evidence/shipping-path-spike/README.md
// ("Image tolerance calibration") on the lit scene of the five brawler scripts.
//
//   CW_TEST_GPU=desktop node games/nr/tests/calibrate.mjs [--out out/unit8/calibration] [--repeats 3] [--publish <file.json>]
//
// For every script (games/nr/tests/brawler.mjs) it runs the native binary on GL and on WebGPU, romdev and Chromium on GL
// (build/cart), Chromium and romdev on WebGPU (build/cart-wgpu), `repeats` times each, plus every host one frame early, and
// measures gt16 (the engine gate's metric, tools/lib/png.mjs) per host pair, each held to the native run on its own API:
//   known good  host vs native over all pairs of repeated runs; native vs native over the repeats
//   known bad   the host's frame blanked; the host's frame in the wrong colour space (sRGB decoded as if it were linear, and
//               encoded twice); the host one frame early; the native one frame early against the native
// Tolerance of a pair: 2 x max(good), floor 0.0005; accepted only if <= min(bad) / 2, else "failed to calibrate" and the
// tolerance is not widened. The nr HUD draws no tick counter, so the spike's tick-only sample has no counterpart here.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { diffImages, readImage } from '../../../deps/cartwheel-engine/tools/lib/png.mjs';
import { FLOOR_GT16 } from '../../spike/tests/gate-strict.mjs';
import { ROOT, SCRIPTS } from './brawler.mjs';
import { REFERENCE, romdevCall, runHost } from './hosts-lib.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const OUT = resolve(ROOT, opt('out', 'out/unit8/calibration'));
const REPEATS = +opt('repeats', 3);
const PUBLISH = opt('publish') ? resolve(ROOT, opt('publish')) : null;
const ONLY = opt('scripts') ? opt('scripts').split(',') : SCRIPTS.map((s) => s.id);
const HOSTS = opt('hosts', 'romdev,chromium,chromium-wgpu,romdev-wgpu').split(',');
mkdirSync(OUT, { recursive: true });

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
const sample = (list, kind, value, label) => list.push({ kind, label, gt16: value });

const data = { generated: new Date().toISOString(), repeats: REPEATS, floor: FLOOR_GT16, scenarios: [], pairs: {} };
const refs = [...new Set(HOSTS.map((h) => REFERENCE[h]))];

for (const id of ONLY) {
  const sc = SCRIPTS.find((s) => s.id === id), F = sc.frames;
  const runs = {};
  const tag = (h, k) => join(OUT, `${id}-${h}-${k}`);
  await Promise.all([...refs, ...HOSTS].map(async (h) => {
    runs[h] = [];
    for (let r = 1; r <= REPEATS; r++) runs[h].push(await runHost(h, sc, F, tag(h, `r${r}`), { session: `nr-unit8-cal-${h}` }));
    runs[h].early = await runHost(h, sc, F - 1, tag(h, 'early'), { session: `nr-unit8-cal-${h}` });
  }));
  const S = { id, app: sc.app, frames: F, good: {}, bad: {}, crossHost: {} };
  for (const h of HOSTS) {
    const ref = REFERENCE[h];
    const good = [], bad = [];
    const nat = runs[ref].map((r) => img(r.shot)), hi = runs[h].map((r) => img(r.shot));
    for (let i = 0; i < nat.length; i++) for (let j = 0; j < hi.length; j++) sample(good, 'host', gt16(nat[i], hi[j]), `${ref} r${i + 1} vs ${h} r${j + 1}`);
    for (let i = 1; i < nat.length; i++) sample(good, 'repeat', gt16(nat[0], nat[i]), `${ref} r1 vs ${ref} r${i + 1}`);
    sample(bad, 'blank', gt16(nat[0], blank(hi[0])), `${ref} vs blank ${h}`);
    sample(bad, 'wrong-colour-space', gt16(nat[0], recolor(hi[0], dec)), `${ref} vs ${h} with sRGB decoded as linear`);
    sample(bad, 'wrong-colour-space', gt16(nat[0], recolor(hi[0], enc)), `${ref} vs ${h} encoded twice`);
    sample(bad, 'one-frame-early', gt16(nat[0], img(runs[h].early.shot)), `${ref} at ${F} vs ${h} at ${F - 1}`);
    sample(bad, 'one-frame-early', gt16(nat[0], img(runs[ref].early.shot)), `${ref} at ${F} vs ${ref} at ${F - 1}`);
    S.good[h] = good; S.bad[h] = bad;
  }
  for (const [a, b] of [['romdev', 'chromium'], ['chromium-wgpu', 'romdev-wgpu']])
    if (HOSTS.includes(a) && HOSTS.includes(b)) S.crossHost[`${a}-vs-${b}`] = gt16(img(runs[a][0].shot), img(runs[b][0].shot));
  data.scenarios.push(S);
  console.log(`${id}: ${HOSTS.map((h) => `${h} good max ${Math.max(...S.good[h].map((x) => x.gt16)).toFixed(6)} bad min ${Math.min(...S.bad[h].map((x) => x.gt16)).toFixed(6)}`).join(' | ')}`);
}

for (const h of HOSTS) {
  const tagged = (k) => data.scenarios.flatMap((s) => s[k][h].map((x) => ({ ...x, scenario: s.id })));
  const good = tagged('good'), bad = tagged('bad');
  const goodMax = Math.max(...good.map((x) => x.gt16)), badMin = Math.min(...bad.map((x) => x.gt16));
  const tolerance = Math.max(2 * goodMax, FLOOR_GT16);
  const accepted = tolerance <= badMin / 2;
  const byKind = (k) => Math.min(...bad.filter((x) => x.kind === k).map((x) => x.gt16));
  data.pairs[h] = { reference: REFERENCE[h], goodMax, goodMaxOf: good.find((x) => x.gt16 === goodMax), badMin, badMinOf: bad.find((x) => x.gt16 === badMin),
    badMinByKind: { blank: byKind('blank'), 'wrong-colour-space': byKind('wrong-colour-space'), 'one-frame-early': byKind('one-frame-early') },
    tolerance, accepted, verdict: accepted ? 'calibrated' : 'failed to calibrate' };
}
writeFileSync(join(OUT, 'calibration.json'), `${JSON.stringify(data, null, 2)}\n`);
if (PUBLISH) { mkdirSync(dirname(PUBLISH), { recursive: true }); writeFileSync(PUBLISH, `${JSON.stringify(data, null, 2)}\n`); }
console.log(JSON.stringify(data.pairs, null, 2));
await romdevCall('nr-unit8-cal-romdev-wgpu', 'host', { op: 'shutdown' }).catch(() => {});
process.exit(Object.values(data.pairs).every((p) => p.accepted) ? 0 : 1);
