#!/usr/bin/env node
// Checks the second hero atlas (player 2's colour sheet) against the first and against the HUD's colours.
//
//   node games/nr/tests/hero-variant-check.mjs [--out <dir>]
//
// hero-p2 is rendered from the same profile as hero with the recipe's paletteOverride (hair, trim, glove), so the frames,
// clips, pivots, alpha and normal sheet are the hero's and only the accent texels differ. The game loads hero-p2.png as a
// second colour sheet over the hero's normal sheet (anim.c nr_atlas_variant). Checks:
//   - manifests: cell, supersample, pages, frame rects and pivots, clips equal; the normal sheet's pixel hash equal
//   - the two colour sheets: alpha equal; every texel that differs is exactly player 1's accent colour in hero.png and
//     player 2's in hero-p2.png (the albedo pass is flat colour), and some do
//   - the accents are the HUD's: ui.c's PINK is player 1's, CYAN player 2's, to the 8-bit value
//   - the budget: the variant adds one decoded colour sheet to the three atlases' total
// Exit status 1 when a check fails. No Blender, GPU or network needed.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT, readImage } from './look-lib.mjs';

const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const OUT = resolve(opt('out') ?? join(ROOT, 'out/round2/hero-variant-check'));
mkdirSync(OUT, { recursive: true });

const dir = join(ROOT, 'games/nr/assets/atlases');
const json = (n) => JSON.parse(readFileSync(join(dir, `${n}.json`), 'utf8'));
const hero = json('hero'), p2 = json('hero-p2');
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`); };

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
check('manifest: cell, supersample, frames, clips', same(hero.cell, p2.cell) && hero.supersample === p2.supersample && same(hero.frames, p2.frames) && same(hero.clips, p2.clips),
  `${hero.frames.length} frames, ${hero.clips.length} clips equal`);
const [h0, p0] = [hero.pages[0], p2.pages[0]];
check('manifest: one page of the same size', hero.pages.length === 1 && p2.pages.length === 1 && h0.width === p0.width && h0.height === p0.height, `${h0.width}x${h0.height}`);
check('manifest: the normal sheet is the hero\'s (pixel hash)', h0.normal.pixelsSha256 === p0.normal.pixelsSha256, h0.normal.pixelsSha256.slice(0, 16));

const a = readImage(join(dir, 'hero.png')), b = readImage(join(dir, 'hero-p2.png'));
check('colour sheets: same size', a.w === b.w && a.h === b.h, `${a.w}x${a.h}`);
let alphaDiff = 0, accent = 0, other = 0, opaque = 0; // other: transparent texels whose dilated colour differs
const pair = new Map();
for (let i = 0; i < a.w * a.h; i++) {
  const o = i * 4;
  if (a.rgba[o + 3] !== b.rgba[o + 3]) alphaDiff++;
  if (a.rgba[o + 3] === 255) opaque++;
  if (a.rgba[o] === b.rgba[o] && a.rgba[o + 1] === b.rgba[o + 1] && a.rgba[o + 2] === b.rgba[o + 2]) continue;
  const key = `${[...a.rgba.slice(o, o + 3)].join(',')}>${[...b.rgba.slice(o, o + 3)].join(',')}`;
  pair.set(key, (pair.get(key) ?? 0) + 1);
  if (a.rgba[o + 3] === 255) accent++; else other++;
}
check('colour sheets: alpha equal', alphaDiff === 0, `${alphaDiff} texels differ in alpha`);

// the HUD's colours: ui.c's PINK and CYAN as 8-bit values
const ui = readFileSync(join(ROOT, 'games/nr/ui.c'), 'utf8');
const hud = (name) => ui.match(new RegExp(`#define ${name} cw_rgba\\(([0-9.]+)f, ([0-9.]+)f, ([0-9.]+)f`)).slice(1, 4).map((v) => Math.round(parseFloat(v) * 255));
const [pink, cyan] = [hud('PINK'), hud('CYAN')];
const rows = [...pair.entries()].sort((x, y) => y[1] - x[1]);
const want = `${pink.join(',')}>${cyan.join(',')}`;
check('colour sheets: every differing texel is player 1\'s accent in hero.png and player 2\'s in hero-p2.png', rows.length > 0 && rows.every(([k]) => k === want),
  `${accent} opaque texels and ${other} dilated transparent ones, ${rows.length} colour pair(s): ${rows.map(([k, n]) => `${k} x${n}`).join('; ')}; wanted ${want}`);
check('the accents are the HUD\'s: PINK (player 1) and CYAN (player 2) of ui.c', rows.length === 1 && rows[0][0] === want, `PINK ${pink.join(',')} CYAN ${cyan.join(',')}`);
check('the accent covers a visible share of the figure', accent / opaque > 0.01, `${(100 * accent / opaque).toFixed(2)}% of the opaque texels of the sheet`);

// decoded budget: the colour sheet of the variant is added once (the normal sheet is shared)
const MiB = 1024 * 1024, sheet = (m) => (m.pages[0].width * m.pages[0].height * 4) / MiB;
const g = json('grunt'), v = json('heavy');
const total = 2 * sheet(hero) + 2 * sheet(g) + 2 * sheet(v) + sheet(p2);
check('budget: the three atlases and the variant fit 64 MiB decoded', total <= 64, `${total.toFixed(2)} MiB (hero pair ${(2 * sheet(hero)).toFixed(2)}, grunt ${(2 * sheet(g)).toFixed(2)}, heavy ${(2 * sheet(v)).toFixed(2)}, variant colour ${sheet(p2).toFixed(2)})`);

writeFileSync(join(OUT, 'hero-variant-check.json'), `${JSON.stringify({ results, pairs: rows, budgetMiB: total }, null, 2)}\n`);
writeFileSync(join(OUT, 'hero-variant-check.txt'), `${results.map((r) => `${r.ok ? 'PASS' : 'FAIL'} ${r.name}: ${r.detail}`).join('\n')}\n`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
