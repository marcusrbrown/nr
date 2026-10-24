// Pairwise pixel differences between the per-host screenshots in a directory (evidence, never a gate):
//   node games/spike/tests/pixel-diff.mjs docs/evidence/shipping-path-spike shot native romdev chromium
//   node games/spike/tests/pixel-diff.mjs <dir> shot-stress native romdev chromium
// Compares <dir>/<prefix>-<hostA>.png with <dir>/<prefix>-<hostB>.png for every pair, with the engine's diffImages.
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const { readImage, diffImages } = await import(join(ROOT, 'deps/cartwheel-engine/tools/lib/png.mjs'));
const [dir, prefix, ...hosts] = process.argv.slice(2);
for (let i = 0; i < hosts.length; i++)
  for (let j = i + 1; j < hosts.length; j++) {
    const a = readImage(join(resolve(dir), `${prefix}-${hosts[i]}.png`)), b = readImage(join(resolve(dir), `${prefix}-${hosts[j]}.png`));
    const d = diffImages(a, b);
    console.log(JSON.stringify({ pair: `${hosts[i]} vs ${hosts[j]}`, size: `${a.w}x${a.h}`, ...d }));
  }
