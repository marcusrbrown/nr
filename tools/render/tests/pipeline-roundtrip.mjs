// Round-trip tests of the render pipeline: nr_render.py (pinned Blender) -> post.mjs -> sheets and manifest.
//
//   node tools/render/tests/pipeline-roundtrip.mjs          artifacts under out/render-test/ (OUT=<dir> to move them)
//
// Needs deps/blender (scripts/fetch-deps.sh). Nothing here needs a display or the network.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  PostError, decodePng, dilatePair, downsampleNormal, layoutFrames, postProcess, validateRecipe, verifyLayout,
} from '../post.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = resolve(process.env.OUT ?? join(ROOT, 'out/render-test'));
const BLENDER = join(ROOT, 'deps/blender/Blender.app/Contents/MacOS/Blender');
const RECIPES = join(ROOT, 'tools/render/recipes');
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const recipe = (name) => JSON.parse(readFileSync(join(RECIPES, `${name}.json`), 'utf8'));

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

/** Run nr_render.py on a recipe file; returns {status, log}. */
function render(recipePath, outDir) {
  const r = spawnSync(BLENDER, ['--background', '--factory-startup', '--python-exit-code', '1', '--python', join(ROOT, 'tools/render/nr_render.py'), '--', '--recipe', recipePath, '--out', outDir], { encoding: 'utf8' });
  return { status: r.status, log: `${r.stdout}${r.stderr}` };
}

/** recipe object -> raw frames -> atlas; returns the manifest and directories. */
function pipeline(label, recipeObj) {
  const dir = join(OUT, label);
  mkdirSync(dir, { recursive: true });
  const recipePath = join(dir, 'recipe.json');
  writeFileSync(recipePath, `${JSON.stringify(recipeObj, null, 2)}\n`);
  const r = render(recipePath, join(dir, 'raw'));
  assert.equal(r.status, 0, r.log.slice(-2000));
  const manifest = postProcess({ recipePath, rawDir: join(dir, 'raw'), outDir: join(dir, 'atlas') });
  return { dir, manifest, atlas: join(dir, 'atlas') };
}

const sheet = (atlas, file) => decodePng(readFileSync(join(atlas, file)));
const px = (img, x, y) => Array.from(img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));

test('every committed recipe validates against the schema', () => {
  for (const f of readdirSync(RECIPES).filter((n) => n.endsWith('.json'))) {
    assert.deepEqual(validateRecipe(JSON.parse(readFileSync(join(RECIPES, f), 'utf8'))), [], f);
  }
  assert.ok(validateRecipe({ ...recipe('placeholder'), supersample: 0 }).length > 0);
  assert.ok(validateRecipe({ ...recipe('placeholder'), extra: 1 }).length > 0);
});

test('placeholder: 4 frames render to colour sheet, normal sheet and manifest, identically on a second run', () => {
  const a = pipeline('placeholder-a', recipe('placeholder'));
  const b = pipeline('placeholder-b', recipe('placeholder'));
  assert.equal(a.manifest.frames.length, 4);
  assert.equal(a.manifest.pages.length, 1);
  for (const f of ['placeholder.png', 'placeholder-n.png', 'placeholder.json']) {
    assert.ok(existsSync(join(a.atlas, f)), f);
    assert.equal(sha256(readFileSync(join(a.atlas, f))), sha256(readFileSync(join(b.atlas, f))), `${f} differs between runs`);
  }
  const [pa] = a.manifest.pages;
  assert.deepEqual([pa.colour.pixelsSha256, pa.normal.pixelsSha256], [b.manifest.pages[0].colour.pixelsSha256, b.manifest.pages[0].normal.pixelsSha256]);
  assert.deepEqual(a.manifest.inputs, b.manifest.inputs);
  assert.equal(a.manifest.recipe.sha256, sha256(readFileSync(join(a.dir, 'recipe.json'))));

  const colour = sheet(a.atlas, 'placeholder.png');
  const normal = sheet(a.atlas, 'placeholder-n.png');
  assert.deepEqual([colour.width, colour.height], [normal.width, normal.height]);
  assert.deepEqual([colour.width, colour.height], [pa.width, pa.height]);
  for (const f of a.manifest.frames) {
    assert.equal(f.empty, false);
    assert.equal(f.ms, 120);
    assert.ok(f.pivot.x >= 0 && f.pivot.x <= f.rect.w && f.pivot.y >= 0 && f.pivot.y <= f.rect.h, 'pivot inside its rect');
    // alpha is binary and identical on both sheets; the frame has opaque texels
    let opaque = 0;
    for (let y = f.rect.y; y < f.rect.y + f.rect.h; y++) {
      for (let x = f.rect.x; x < f.rect.x + f.rect.w; x++) {
        const c = px(colour, x, y), n = px(normal, x, y);
        assert.ok(c[3] === 0 || c[3] === 255);
        assert.equal(c[3], n[3]);
        if (c[3] === 255) opaque++;
      }
    }
    assert.ok(opaque > 200, `frame ${f.index} has ${opaque} opaque texels`);
  }
  // the pivot (feet) sits on the lowest opaque row of frame 0, within 2 px
  const f0 = a.manifest.frames[0];
  let lowest = 0;
  for (let y = 0; y < f0.rect.h; y++) for (let x = 0; x < f0.rect.w; x++) if (px(colour, f0.rect.x + x, f0.rect.y + y)[3] === 255) lowest = y;
  assert.ok(Math.abs(lowest + 1 - f0.pivot.y) <= 2, `lowest opaque row ${lowest} vs pivot ${f0.pivot.y}`);
  // the animated arm makes frames differ
  assert.notEqual(a.manifest.inputs[1].albedoSha256, a.manifest.inputs[3].albedoSha256);
  assert.deepEqual(a.manifest.clips, [{ name: 'idle', slot: 'idle', first: 0, count: 4, facing: 'east', ms: 120, loop: true }]);
});

test('flat-plane control: the normal sheet is uniform (0.5, 0.5, 1) within 1/255', () => {
  const { atlas, manifest } = pipeline('flat', recipe('flat-control'));
  const n = sheet(atlas, 'flat-control-n.png');
  let opaque = 0;
  for (let i = 0; i < n.width * n.height; i++) {
    const [r, g, b, a] = n.data.subarray(i * 4, i * 4 + 4);
    if (a === 0) continue;
    opaque++;
    assert.ok(Math.abs(r - 127.5) <= 1 && Math.abs(g - 127.5) <= 1 && b >= 254, `texel ${i}: ${r},${g},${b}`);
  }
  assert.ok(opaque > 500);
  assert.equal(manifest.frames[0].empty, false);
});

test('vertical control: green > 0.5 on top-facing texels, < 0.5 on bottom-facing ones, red follows screen x', () => {
  const { atlas } = pipeline('vertical', recipe('vertical-control'));
  const n = sheet(atlas, 'vertical-control-n.png');
  const rows = [];
  for (let y = 0; y < n.height; y++) {
    const xs = [];
    for (let x = 0; x < n.width; x++) if (px(n, x, y)[3] === 255) xs.push(x);
    if (xs.length) rows.push({ y, xs });
  }
  const top = rows[0].y, bottom = rows[rows.length - 1].y, mid = (top + bottom) / 2;
  let up = 0, down = 0;
  for (const { y, xs } of rows) {
    for (const x of xs) {
      const [, g, b] = px(n, x, y);
      assert.ok(b > 127, `texel (${x},${y}) faces away from the camera: blue ${b}`);
      if (y < mid - 2) { assert.ok(g > 128, `top-facing texel (${x},${y}): green ${g}`); up++; }
      if (y > mid + 2) { assert.ok(g < 127, `bottom-facing texel (${x},${y}): green ${g}`); down++; }
    }
  }
  assert.ok(up > 50 && down > 50);
  // green falls monotonically down the centre column; red rises left to right along the centre row
  const cx = Math.round((Math.min(...rows.map((r) => r.xs[0])) + Math.max(...rows.map((r) => r.xs[r.xs.length - 1]))) / 2);
  let prev = 256;
  for (const { y } of rows) { const g = px(n, cx, y)[1]; assert.ok(g <= prev, `green rises at row ${y}`); prev = g; }
  const mr = rows.reduce((best, r) => (Math.abs(r.y - mid) < Math.abs(best.y - mid) ? r : best));
  assert.ok(px(n, mr.xs[0], mr.y)[0] < 100 && px(n, mr.xs[mr.xs.length - 1], mr.y)[0] > 155, 'red follows screen right');
});

test('a frame with zero visible pixels is marked empty, not an error', () => {
  const r = recipe('placeholder');
  r.slots[0].hideFrames = [2];
  const { manifest, atlas } = pipeline('empty', r);
  assert.deepEqual(manifest.frames.map((f) => f.empty), [false, false, true, false]);
  const colour = sheet(atlas, 'placeholder.png');
  const f = manifest.frames[2];
  for (let y = f.rect.y; y < f.rect.y + f.rect.h; y++) for (let x = f.rect.x; x < f.rect.x + f.rect.w; x++) assert.equal(px(colour, x, y)[3], 0);
});

test('Blender version mismatch: exit 11, names expected and found, no outputs', () => {
  const dir = join(OUT, 'mismatch');
  mkdirSync(dir, { recursive: true });
  const r = recipe('placeholder');
  r.blender.version = '4.5.14';
  const p = join(dir, 'recipe.json');
  writeFileSync(p, JSON.stringify(r));
  const run = render(p, join(dir, 'raw'));
  assert.equal(run.status, 11, run.log.slice(-1500));
  assert.match(run.log, /expected '4\.5\.14' build '5afeabba6097', found '4\.5\.15' build '5afeabba6097'/);
  assert.equal(existsSync(join(dir, 'raw')), false);
  assert.equal(existsSync(join(dir, 'raw.partial')), false);

  const bad = { ...recipe('placeholder'), blender: { version: '4.5.15', buildHash: '000000000000' } };
  writeFileSync(p, JSON.stringify(bad));
  assert.equal(render(p, join(dir, 'raw2')).status, 11);
});

test('input errors exit 12; an existing output directory is refused', () => {
  const dir = join(OUT, 'input-error');
  mkdirSync(join(dir, 'exists'), { recursive: true });
  const r = recipe('placeholder');
  const p = join(dir, 'recipe.json');
  writeFileSync(p, JSON.stringify(r));
  assert.equal(render(p, join(dir, 'exists')).status, 12);
  writeFileSync(p, JSON.stringify({ ...r, slots: [{ id: 'a', clip: 'a', frames: 0 }] }));
  assert.equal(render(p, join(dir, 'raw')).status, 12);
  assert.equal(existsSync(join(dir, 'raw')), false);
});

test('post.mjs refuses a raw directory without its sentinel or rendered from another recipe', () => {
  const a = pipeline('sentinel', recipe('placeholder'));
  const recipePath = join(a.dir, 'recipe.json');
  const raw = join(a.dir, 'raw');
  const noSentinel = join(a.dir, 'raw-nosentinel');
  cpSync(raw, noSentinel, { recursive: true });
  rmSync(join(noSentinel, 'done.json'));
  assert.throws(() => postProcess({ recipePath, rawDir: noSentinel, outDir: join(a.dir, 'x1') }), PostError);
  const other = join(a.dir, 'other.json');
  writeFileSync(other, JSON.stringify({ ...recipe('placeholder'), name: 'other' }));
  assert.throws(() => postProcess({ recipePath: other, rawDir: raw, outDir: join(a.dir, 'x2') }), /different recipe/);
  const tampered = join(a.dir, 'raw-tampered');
  cpSync(raw, tampered, { recursive: true });
  writeFileSync(join(tampered, 'normal', '001.png'), readFileSync(join(raw, 'normal', '000.png')).subarray(0, 100));
  assert.throws(() => postProcess({ recipePath, rawDir: tampered, outDir: join(a.dir, 'x3') }), /frame 1 .*differs from the payload hash/);
});

test('normals are averaged as vectors and renormalised', () => {
  // a 2x2 block of one supersample step: +X, +Y, and two transparent sub-pixels
  const src = new Uint8Array(2 * 2 * 4);
  src.set([255, 128, 128, 255, 128, 255, 128, 255, 0, 0, 0, 0, 0, 0, 0, 0]);
  const out = downsampleNormal(src, 1, 1, 2);
  const v = [out[0] / 127.5 - 1, out[1] / 127.5 - 1, out[2] / 127.5 - 1];
  assert.ok(Math.abs(Math.hypot(...v) - 1) < 0.02, `length ${Math.hypot(...v)}`);
  assert.ok(Math.abs(v[0] - Math.SQRT1_2) < 0.02 && Math.abs(v[1] - Math.SQRT1_2) < 0.02 && Math.abs(v[2]) < 0.02);
});

test('dilation copies colour and normal into transparent edge texels and leaves alpha 0', () => {
  const colour = new Uint8Array(3 * 1 * 4), normal = new Uint8Array(3 * 1 * 4);
  colour.set([200, 10, 10, 255]);
  normal.set([50, 60, 70, 255]);
  const opaque = dilatePair(colour, normal, 3, 1, 1);
  assert.equal(opaque, 1);
  assert.deepEqual(Array.from(colour.subarray(4, 8)), [200, 10, 10, 0]);
  assert.deepEqual(Array.from(normal.subarray(4, 8)), [50, 60, 70, 0]);
  assert.deepEqual(Array.from(colour.subarray(8, 12)), [0, 0, 0, 0]);
});

test('a clip longer than one page continues on page 2 and the manifest records the page', () => {
  const { placements, pages } = layoutFrames(5, 48, 64, 128);
  assert.deepEqual(placements.map((p) => p.page), [0, 0, 0, 0, 1]);
  assert.deepEqual(pages, [{ width: 96, height: 128 }, { width: 48, height: 64 }]);
  const r = recipe('placeholder');
  r.atlas.pageSize = 128;
  r.slots[0].frames = 5;
  const { manifest, atlas } = pipeline('pages', r);
  assert.deepEqual(manifest.frames.map((f) => f.page), [0, 0, 0, 0, 1]);
  assert.equal(manifest.pages.length, 2);
  assert.ok(existsSync(join(atlas, 'placeholder.1.png')) && existsSync(join(atlas, 'placeholder.1-n.png')));
});

test('verifyLayout fails naming the frame whose rect leaves its page, and a sheet size mismatch', () => {
  const { manifest, atlas } = pipeline('layout', recipe('placeholder'));
  const bad = structuredClone(manifest);
  bad.frames[2].rect.x = 500;
  assert.throws(() => verifyLayout(bad, atlas), /frame 2 \(idle 2\)/);
  const mismatch = structuredClone(manifest);
  mismatch.pages[0].normal.file = 'placeholder-n.png';
  mismatch.pages[0].colour.file = 'placeholder.png';
  mismatch.pages[0].width += 8;
  assert.throws(() => verifyLayout(mismatch, atlas), /differs from the manifest/);
});

test('fetch-deps.sh: a tampered cart-wgpu sha256 in the lock aborts and leaves no partial directory', () => {
  const dir = join(OUT, 'tamper');
  const deps = join(dir, 'deps');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(deps, 'cartwheel-sdk'), { recursive: true });
  // what is already installed is linked in, so the run reaches the cart-wgpu row without refetching anything else
  for (const d of ['cartwheel-engine', 'wasi-sdk', 'binaryen']) symlinkSync(join(ROOT, 'deps', d), join(deps, d));
  for (const d of ['macos-arm64', 'cart']) symlinkSync(join(ROOT, 'deps/cartwheel-sdk', d), join(deps, 'cartwheel-sdk', d));
  const tarball = join(ROOT, 'deps/.dl/cartwheel-sdk-0.15.1-cart-wgpu.tar.gz');
  assert.ok(existsSync(tarball), 'run scripts/fetch-deps.sh first');
  const lock = readFileSync(join(ROOT, 'scripts/deps.lock'), 'utf8').split('\n').map((l) => {
    if (!l.startsWith('cartwheel-sdk:cart-wgpu ')) return l;
    const [name, , ver, sha] = l.split(/\s+/);
    return `${name} file://${tarball} ${ver} ${sha.replace(/^./, (c) => (c === '0' ? '1' : '0'))}`;
  }).join('\n');
  const lockPath = join(dir, 'deps.lock');
  writeFileSync(lockPath, lock);
  const r = spawnSync('bash', [join(ROOT, 'scripts/fetch-deps.sh')], { encoding: 'utf8', env: { ...process.env, DEPS_LOCK: lockPath, DEPS_DIR: deps } });
  assert.notEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stderr, /cartwheel-sdk:cart-wgpu: sha256 mismatch/);
  assert.equal(existsSync(join(deps, 'cartwheel-sdk', 'cart-wgpu')), false);
  assert.deepEqual(readdirSync(deps).filter((n) => n.startsWith('.stage')), []);
  assert.deepEqual(readdirSync(join(deps, '.dl')).filter((n) => n.endsWith('.part')), []);
});
