// Pairwise pixel differences between per-host screenshots in a directory (evidence, never a gate):
//   node games/litspike/tests/pixel-diff.mjs <dir> <frames,...> <label:file-prefix> [<label:file-prefix> ...]
//   node games/litspike/tests/pixel-diff.mjs out/litspike/shots 60,120,180,240 gl-native:native- gl-chromium:chromium- wgpu-native:wgpu-native- wgpu-chromium:wgpu-chromium-
// Compares <dir>/<prefix>f<frames>.png of every pair of labels with the engine's diffImages and diffAreas
// (7x7 blocks whose every pixel differs by more than 35 in brightness).
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const { readImage, diffImages, diffAreas } = await import(join(ROOT, 'deps/cartwheel-engine/tools/lib/png.mjs'));
const [dir, frameList, ...hosts] = process.argv.slice(2);
const sets = hosts.map((h) => { const i = h.indexOf(':'); return { label: h.slice(0, i), prefix: h.slice(i + 1) }; });
for (const f of frameList.split(',')) {
  for (let i = 0; i < sets.length; i++)
    for (let j = i + 1; j < sets.length; j++) {
      const a = readImage(join(resolve(dir), `${sets[i].prefix}f${f}.png`)), b = readImage(join(resolve(dir), `${sets[j].prefix}f${f}.png`));
      const d = diffImages(a, b);
      const areas = diffAreas(a, b);
      console.log(JSON.stringify({ frame: +f, pair: `${sets[i].label} vs ${sets[j].label}`, size: `${a.w}x${a.h}`, ...d, areaShare: areas.comparable === false ? undefined : areas.share ?? areas }));
    }
}
