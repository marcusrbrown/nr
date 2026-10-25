#!/usr/bin/env node
// The title's prompt reads over the hero and the lit street, in both phases of its blink.
//
//   CW_TEST_GPU=desktop node games/nr/tests/title-contrast-check.mjs [--out out/round2/title-contrast] [--before <title.png>]
//
// The native binary on WebGPU runs `nr` on input-2p-full.json to tick 30 and tick 60 (the title with player 1 in: the panel's
// edge blink is at its dim phase at 30 and its full phase at 60) and the prompt's box is read from the picture: ui.c draws "PRESS START
// AGAIN TO FIGHT" at y = 0.74 H, 64 px (design units) on a panel. The text colour is the amber of ui.c's AMBER at the
// blink's alpha; the backing is the pixels of the panel that are not text. The contrast ratio is WCAG's (relative luminance of the
// brightest text pixel over the mean of the backing, each +0.05); the bar is 7:1 in both phases. --before names the capture of
// the same tick from before the panel existed, which is measured the same way over the same box for the report.
// Exit status 1 when a phase is under the bar.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT, readImage } from './look-lib.mjs';
import { nativeWgpu } from './capture-lib.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const OUT = resolve(ROOT, opt('out', 'out/round2/title-contrast'));
const BEFORE = opt('before', null);
mkdirSync(OUT, { recursive: true });

const lin = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const relLum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
// the prompt's box in a 1920x1080 picture: the text line (H * 0.74, 64 px) with the panel's margin
const BOX = { x0: 380, x1: 1540, y0: 790, y1: 880 };

/** contrast of the prompt in an image: text pixels are the amber ones (red high, blue low, luminance above the backing) */
function measure(img, loose = false) {
  const back = [], text = [];
  for (let y = BOX.y0; y < BOX.y1; y++) for (let x = BOX.x0; x < BOX.x1; x++) {
    const o = (y * img.w + x) * 4, [r, g, b] = [img.rgba[o], img.rgba[o + 1], img.rgba[o + 2]];
    ((loose ? r > 90 && g > 55 && b < 90 && r > b * 2 : r > 150 && g > 90 && b < 110 && r > b * 2) ? text : back).push(relLum(r, g, b));
  }
  if (text.length < 200) return { textPixels: text.length, backPixels: back.length, ratio: 0 };
  const top = text.sort((a, b) => b - a)[Math.floor(text.length * 0.1)]; // the 90th percentile text pixel: robust to the outline's blend
  const mean = back.reduce((s, v) => s + v, 0) / back.length;
  return { textPixels: text.length, backPixels: back.length, textLum: +top.toFixed(4), backLum: +mean.toFixed(4), ratio: +((top + 0.05) / (mean + 0.05)).toFixed(2) };
}

const results = [];
let failed = 0;
for (const tick of [30, 60]) {
  const base = join(OUT, `title-f${tick}`);
  const r = nativeWgpu('nr', base, tick, { input: 'games/nr/tests/input-2p-full.json', inputDir: join(OUT, 'input') });
  if (r.status !== 0) { console.log(`FAIL tick ${tick}: native ${r.status} ${(r.stderr || '').slice(-200)}`); failed++; continue; }
  const m = measure(readImage(`${base}.png`));
  const ok = m.ratio >= 7;
  if (!ok) failed++;
  results.push({ tick, ...m, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} tick ${tick}: prompt contrast ${m.ratio}:1 (text luminance ${m.textLum}, backing ${m.backLum}; ${m.textPixels} text pixels)`);
}
if (BEFORE) {
  const m = measure(readImage(resolve(ROOT, BEFORE)), true); // the old prompt was amber at 0.45 alpha: a dimmer brown, so a looser colour test finds it
  results.push({ before: BEFORE, ...m });
  console.log(`     before the panel (${BEFORE}): ${m.ratio}:1 (${m.textPixels} text pixels)`);
}
writeFileSync(join(OUT, 'title-contrast-check.json'), `${JSON.stringify({ bar: 7, results }, null, 2)}\n`);
process.exit(failed ? 1 : 0);
