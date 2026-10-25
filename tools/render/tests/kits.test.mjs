// Tests of tools/render/kits.mjs: the fail-closed licence gate, sha256 pins and the first-fetch (--pin) flow.
//
//   node --test tools/render/tests/kits.test.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { ALLOWED_LICENCES, KitError, assertLicenceAllowed, loadManifest, selectKits, stageKit } from '../kits.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const LICENCE = 'License:\nCC0 1.0 Universal (CC0 1.0)\nPublic Domain Dedication\n';

function fixture({ spdx = 'CC0-1.0', licenceText = LICENCE } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'nr-kits-test-'));
  const src = join(dir, 'download');
  mkdirSync(src);
  writeFileSync(join(src, 'License.txt'), licenceText);
  writeFileSync(join(src, 'Pack.glb'), 'glb-bytes');
  const manifest = {
    schemaVersion: 1,
    kits: [{
      id: 'toy', title: 'Toy', sourceUrl: 'https://example.invalid/', downloadPage: 'https://example.invalid/dl',
      licence: { spdx }, licenceFile: { path: 'License.txt', sha256: sha(licenceText) }, files: [{ path: 'Pack.glb', sha256: sha('glb-bytes'), size: 9 }],
    }],
  };
  return { dir, src, manifest, depsDir: join(dir, 'deps-kits') };
}

test('the allowlist is CC0-1.0 only', () => {
  assert.deepEqual([...ALLOWED_LICENCES], ['CC0-1.0']);
  const committed = loadManifest();
  for (const kit of committed.kits) assert.doesNotThrow(() => assertLicenceAllowed(kit), kit.id);
});

test('a verified kit is staged', () => {
  const f = fixture();
  const report = stageKit({ manifest: f.manifest, kitId: 'toy', depsDir: f.depsDir, from: f.src });
  assert.equal(report.length, 2);
  assert.equal(readFileSync(join(f.depsDir, 'toy/Pack.glb'), 'utf8'), 'glb-bytes');
  rmSync(f.dir, { recursive: true, force: true });
});

test('a licence off the allowlist is refused and nothing is staged', () => {
  const f = fixture({ spdx: 'CC-BY-4.0' });
  assert.throws(() => stageKit({ manifest: f.manifest, kitId: 'toy', depsDir: f.depsDir, from: f.src }), /not on the allowlist/);
  assert.throws(() => readFileSync(join(f.depsDir, 'toy/Pack.glb')));
  rmSync(f.dir, { recursive: true, force: true });
});

test('a licence file that does not state CC0 is refused', () => {
  const f = fixture({ licenceText: 'All rights reserved.' });
  assert.throws(() => stageKit({ manifest: f.manifest, kitId: 'toy', depsDir: f.depsDir, from: f.src }), /does not state "CC0 1.0 Universal"/);
  rmSync(f.dir, { recursive: true, force: true });
});

test('a tampered file (sha256 differs from the pin) is refused and nothing is staged', () => {
  const f = fixture();
  writeFileSync(join(f.src, 'Pack.glb'), 'tampered');
  assert.throws(() => stageKit({ manifest: f.manifest, kitId: 'toy', depsDir: f.depsDir, from: f.src }), /differs from the pin/);
  assert.throws(() => readFileSync(join(f.depsDir, 'toy/Pack.glb')));
  rmSync(f.dir, { recursive: true, force: true });
});

test('an unpinned file is refused without --pin and pinned with it', () => {
  const f = fixture();
  f.manifest.kits[0].files = [{ path: 'Pack.glb', sha256: null, size: null }];
  assert.throws(() => stageKit({ manifest: f.manifest, kitId: 'toy', depsDir: f.depsDir, from: f.src }), /no sha256 pin/);
  stageKit({ manifest: f.manifest, kitId: 'toy', depsDir: f.depsDir, from: f.src, pin: true });
  assert.deepEqual(f.manifest.kits[0].files, [{ path: 'Pack.glb', sha256: sha('glb-bytes'), size: 9 }]);
  rmSync(f.dir, { recursive: true, force: true });
});

test('a missing file names the download page', () => {
  const f = fixture();
  assert.throws(() => stageKit({ manifest: f.manifest, kitId: 'toy', depsDir: f.depsDir }), /example\.invalid\/dl/);
  rmSync(f.dir, { recursive: true, force: true });
});

test('the committed manifest names a manual-download page for every kit', () => {
  for (const kit of loadManifest().kits) {
    assert.match(kit.downloadPage, /^https:\/\/quaternius\.itch\.io\//, kit.id);
    assert.equal(kit.acquisition.method, 'manual', kit.id);
  }
});

test('an unknown --kit id is an error that lists the valid ids, and --pin writes nothing', () => {
  const f = fixture();
  assert.throws(() => selectKits(f.manifest, 'ual2'), (e) => e instanceof KitError && /unknown kit id "ual2"; valid ids: toy$/.test(e.message));
  assert.equal(selectKits(f.manifest, 'toy').length, 1);
  assert.equal(selectKits(f.manifest, undefined).length, 1);

  const manifestPath = join(f.dir, 'kits.json');
  writeFileSync(manifestPath, JSON.stringify(f.manifest, null, 2));
  const before = readFileSync(manifestPath, 'utf8');
  const r = spawnSync('node', [join(ROOT, 'tools/render/kits.mjs'), '--from', f.src, '--kit', 'ual2', '--pin'], { encoding: 'utf8', env: { ...process.env, KITS_JSON: manifestPath, KITS_DIR: f.depsDir } });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /unknown kit id "ual2"; valid ids: toy/);
  assert.equal(r.stdout, '');
  assert.equal(readFileSync(manifestPath, 'utf8'), before, 'the manifest is untouched');
  const bare = spawnSync('node', [join(ROOT, 'tools/render/kits.mjs'), '--kit'], { encoding: 'utf8', env: { ...process.env, KITS_JSON: manifestPath, KITS_DIR: f.depsDir } });
  assert.equal(bare.status, 1);
  assert.match(bare.stderr, /--kit needs a kit id/);
  rmSync(f.dir, { recursive: true, force: true });
});
