// Tests of the kit route: the hero profile and recipe, the kit and licence checks of nr_render.py, and a two-run
// reproducibility check of the hero atlas.
//
//   node --test tools/render/tests/hero-profile.mjs        artifacts under out/render-test-hero/ (OUT=<dir> to move them)
//
// Needs deps/blender (scripts/fetch-deps.sh) and the staged kits (tools/render/fetch-kits.sh).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { PROFILE_SCHEMA_PATH, decodePng, postProcess, validateRecipe } from '../post.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = resolve(process.env.OUT ?? join(ROOT, 'out/render-test-hero'));
const BLENDER = join(ROOT, 'deps/blender/Blender.app/Contents/MacOS/Blender');
const RENDER = join(ROOT, 'tools/render');
const KITS = join(ROOT, 'deps/kits');
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
const profilePath = join(RENDER, 'profiles/hero.json');
const recipePath = join(RENDER, 'recipes/hero.json');
const profile = json(profilePath);
const recipe = json(recipePath);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

function render(recipeFile, outDir, kits = KITS) {
  const r = spawnSync(BLENDER, ['--background', '--factory-startup', '--python-exit-code', '1', '--python', join(RENDER, 'nr_render.py'), '--', '--recipe', recipeFile, '--out', outDir, '--kits', kits], { encoding: 'utf8' });
  return { status: r.status, log: `${r.stdout}${r.stderr}` };
}

/** Run the hero recipe (the committed one, profile beside it) into <OUT>/<label> and post-process it. */
function pipeline(label) {
  const dir = join(OUT, label);
  mkdirSync(dir, { recursive: true });
  const r = render(recipePath, join(dir, 'raw'));
  assert.equal(r.status, 0, r.log.slice(-2500));
  const manifest = postProcess({ recipePath, rawDir: join(dir, 'raw'), outDir: join(dir, 'atlas') });
  return { dir, manifest, atlas: join(dir, 'atlas'), done: json(join(dir, 'raw/done.json')) };
}

test('the hero profile and recipe validate against their schemas', () => {
  assert.deepEqual(validateRecipe(profile, json(PROFILE_SCHEMA_PATH)), []);
  assert.deepEqual(validateRecipe(recipe), []);
  const bad = structuredClone(profile);
  bad.regions[0].bones = [];
  assert.ok(validateRecipe(bad, json(PROFILE_SCHEMA_PATH)).length > 0);
  assert.ok(validateRecipe({ ...recipe, model: { ...recipe.model, parts: [] } }).length > 0, 'parts and profile together');
});

test('every kit file the profile names is a CC0 kit file kits.json pins, and the recipe pins this profile', () => {
  const kits = json(join(RENDER, 'kits.json'));
  for (const ref of profile.kitFiles) {
    const kit = kits.kits.find((k) => k.id === ref.kit);
    assert.ok(kit, ref.kit);
    assert.equal(kit.licence.spdx, 'CC0-1.0');
    assert.equal(kit.files.find((f) => f.path === ref.path)?.sha256, ref.sha256, ref.path);
  }
  const used = [profile.models.body, profile.models.animations, ...profile.models.hair];
  for (const m of used) assert.ok(profile.kitFiles.some((r) => r.kit === m.kit && r.path === m.path), m.path);
  assert.equal(recipe.model.profileSha256, sha256(readFileSync(profilePath)), 'run: node tools/render/pin-profile.mjs tools/render/recipes/hero.json');
});

test('the recipe renders only ready clips, and every clip of the map names real actions with the audit status', () => {
  for (const s of recipe.slots) assert.equal(profile.clips[s.clip]?.ready, true, `slot ${s.id}`);
  const auditJson = join(ROOT, 'out/render/audit/clip-audit.json');
  if (!existsSync(auditJson)) assert.equal(spawnSync('bash', [join(RENDER, 'render-all.sh'), '--audit'], { encoding: 'utf8' }).status, 0);
  const actions = new Map(json(auditJson).files.flatMap((f) => f.actions.map((a) => [a.name, a])));
  const targets = json(join(RENDER, 'clip-targets.json')).characters.hero;
  for (const [name, clip] of Object.entries(profile.clips)) {
    for (const sg of clip.segments) {
      const a = actions.get(sg.action);
      assert.ok(a, `${name}: no action ${sg.action}`);
      for (const f of [sg.start, sg.end]) assert.ok(f >= a.start - 1e-6 && f <= a.end + 1e-6, `${name}: ${sg.action} frame ${f} outside ${a.start}-${a.end}`);
    }
    assert.equal(clip.segments.length === 0, clip.status === 'gap', `${name}: gap iff no segments`);
  }
  const slot = (n) => ({ jumpkick: 'jump kick' })[n] ?? n;
  for (const [name, clip] of Object.entries(profile.clips)) {
    const t = targets.find((x) => x.slot === slot(name));
    assert.ok(t, `clip-targets.json has no hero slot ${name}`);
    assert.equal(t.status, clip.status, `${name}: profile status differs from the audit table`);
  }
});

test('hero atlas: identical hashes on two runs, 128 px tall, pivot on the ground, centred, green-up normals', () => {
  const a = pipeline('a');
  const b = pipeline('b');
  assert.deepEqual(a.manifest.inputs, b.manifest.inputs);
  assert.deepEqual(a.manifest.pages.map((p) => [p.colour.pixelsSha256, p.normal.pixelsSha256]), b.manifest.pages.map((p) => [p.colour.pixelsSha256, p.normal.pixelsSha256]));
  assert.deepEqual(a.manifest.frames, b.manifest.frames);
  assert.deepEqual(a.manifest.clips.map((c) => [c.name, c.count, c.ms, c.loop]), [['idle', 8, 250, true], ['walk', 8, 120, true]]);
  assert.equal(a.manifest.profile.sha256, recipe.model.profileSha256);
  assert.deepEqual(a.manifest.profile.kitFiles.map((f) => f.path), profile.kitFiles.map((f) => f.path));

  const colour = decodePng(readFileSync(join(a.atlas, 'hero.png')));
  const normal = decodePng(readFileSync(join(a.atlas, 'hero-n.png')));
  const px = (img, x, y) => img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4);
  for (const f of a.manifest.frames) {
    assert.deepEqual(f.pivot, { x: 80, y: 144 });
    let top = Infinity, bottom = -1, minX = Infinity, maxX = -1;
    for (let y = 0; y < f.rect.h; y++) for (let x = 0; x < f.rect.w; x++) {
      if (px(colour, f.rect.x + x, f.rect.y + y)[3] !== 255) continue;
      top = Math.min(top, y); bottom = Math.max(bottom, y); minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    }
    assert.ok(bottom + 1 >= f.pivot.y - 4 && bottom + 1 <= f.pivot.y + 10, `frame ${f.index}: lowest row ${bottom + 1} vs ground ${f.pivot.y}`);
    if (f.clip === 'idle' && f.clipFrame === 0) assert.ok(Math.abs(bottom + 1 - top - 128) <= 3, `idle 0 is ${bottom + 1 - top} px tall`);
    assert.ok(minX > 8 && maxX < f.rect.w - 8, `frame ${f.index}: silhouette ${minX}-${maxX} touches the cell edge`);
    assert.ok(top > 4, `frame ${f.index}: head at row ${top}`);
    assert.ok(Math.abs((minX + maxX) / 2 - f.pivot.x) < 40, `frame ${f.index}: silhouette centre ${(minX + maxX) / 2}`);
    let g = 0, n = 0;
    for (let y = top; y < top + 3; y++) for (let x = 0; x < f.rect.w; x++) {
      if (px(colour, f.rect.x + x, f.rect.y + y)[3] !== 255) continue;
      g += px(normal, f.rect.x + x, f.rect.y + y)[1]; n++;
    }
    assert.ok(n > 3 && g / n > 150, `frame ${f.index}: the top of the head faces up, mean green ${g / n}`);
  }
  // a normal texel is a unit vector within quantisation error
  const f0 = a.manifest.frames[0];
  let checked = 0;
  for (let y = 0; y < f0.rect.h; y++) for (let x = 0; x < f0.rect.w; x++) {
    const n = px(normal, f0.rect.x + x, f0.rect.y + y);
    if (n[3] !== 255) continue;
    const len = Math.hypot(n[0] / 127.5 - 1, n[1] / 127.5 - 1, n[2] / 127.5 - 1);
    assert.ok(Math.abs(len - 1) < 0.04, `normal length ${len}`);
    checked++;
  }
  assert.ok(checked > 1500, `${checked} opaque texels in idle 0`);
  assert.ok(a.done.profile.figure.heightPx > 127.9 && a.done.profile.figure.heightPx < 128.1);
});

test('a kit file that differs from its pinned sha256 exits 12 and writes nothing', () => {
  const dir = join(OUT, 'tampered-kit');
  const kits = join(dir, 'kits');
  mkdirSync(dir, { recursive: true });
  cpSync(KITS, kits, { recursive: true });
  const file = join(kits, 'universal-animation-library/UAL1_Standard.glb');
  writeFileSync(file, Buffer.concat([readFileSync(file), Buffer.from([0])]));
  const r = render(recipePath, join(dir, 'raw'), kits);
  assert.equal(r.status, 12, r.log.slice(-1500));
  assert.match(r.log, /UAL1_Standard\.glb differs from its pinned sha256/);
  assert.equal(existsSync(join(dir, 'raw')) || existsSync(join(dir, 'raw.partial')), false);
});

test('an unstaged kit exits 12 naming fetch-kits.sh', () => {
  const dir = join(OUT, 'no-kits');
  mkdirSync(dir, { recursive: true });
  const r = render(recipePath, join(dir, 'raw'), join(dir, 'empty'));
  assert.equal(r.status, 12);
  assert.match(r.log, /not staged: run tools\/render\/fetch-kits\.sh/);
});

test('a recipe that pins another profile hash exits 12 naming both', () => {
  const dir = join(OUT, 'stale-pin');
  mkdirSync(dir, { recursive: true });
  const stale = structuredClone(recipe);
  stale.model.profileSha256 = '0'.repeat(64);
  mkdirSync(join(dir, 'recipes'), { recursive: true });
  cpSync(join(RENDER, 'profiles'), join(dir, 'profiles'), { recursive: true });
  writeFileSync(join(dir, 'recipes/hero.json'), JSON.stringify(stale));
  const r = render(join(dir, 'recipes/hero.json'), join(dir, 'raw'));
  assert.equal(r.status, 12, r.log.slice(-800));
  assert.match(r.log, /has sha256 [0-9a-f]{64}, the recipe pins 0{64}/);
});

test('a slot naming a clip the profile lacks exits 12', () => {
  const dir = join(OUT, 'no-clip');
  mkdirSync(join(dir, 'recipes'), { recursive: true });
  cpSync(join(RENDER, 'profiles'), join(dir, 'profiles'), { recursive: true });
  const bad = structuredClone(recipe);
  bad.slots[0].clip = 'moonwalk';
  writeFileSync(join(dir, 'recipes/hero.json'), JSON.stringify(bad));
  const r = render(join(dir, 'recipes/hero.json'), join(dir, 'raw'));
  assert.equal(r.status, 12);
  assert.match(r.log, /the profile has no clip 'moonwalk'/);
});
