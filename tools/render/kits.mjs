#!/usr/bin/env node
// Stage the pinned character kits (tools/render/kits.json) into deps/kits/<kit id>/ (gitignored).
//
//   tools/render/fetch-kits.sh                         verify and stage what kits.json pins (deps/kits/ already holds it)
//   tools/render/fetch-kits.sh --from <dir>            stage from a directory (or .zip files in it) the owner downloaded
//   tools/render/fetch-kits.sh --from <dir> --kit <id> --pin
//                                                      first fetch of a kit: copy every kit file found under <dir>, add
//                                                      or update its entries in kits.json with the computed sha256 and
//                                                      size (commit the result)
//   tools/render/fetch-kits.sh --check                 verify the manifest and deps/kits/ only; stage nothing
//
// The Quaternius packs are distributed through itch.io's per-download token flow (the pack pages' download buttons are
// Itch.attachBuyButton), which has no stable direct URL, and the project publishes no GitHub release for them. The
// download is therefore manual; this script is the gate behind it:
//   - licence allowlist, fail closed: a kit whose licence.spdx is not in ALLOWED_LICENCES is refused, and so is a kit
//     whose licence file is missing, differs from its pinned sha256, or does not state CC0
//   - a file whose sha256 differs from the pin is refused; a file with no pin is refused unless --pin is given
//   - nothing is written into deps/kits/ until every file of the kit verified
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
export const KITS_JSON = join(HERE, 'kits.json');
export const ALLOWED_LICENCES = new Set(['CC0-1.0']);
const KIT_EXTENSIONS = new Set(['.glb', '.gltf', '.bin', '.blend']);

export class KitError extends Error {}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

export function loadManifest(path = KITS_JSON) {
  const m = JSON.parse(readFileSync(path, 'utf8'));
  if (m.schemaVersion !== 1 || !Array.isArray(m.kits)) throw new KitError(`${path}: not a schemaVersion 1 kit manifest`);
  const ids = new Set();
  for (const kit of m.kits) {
    for (const k of ['id', 'title', 'sourceUrl', 'downloadPage', 'licence', 'licenceFile', 'files']) {
      if (!(k in kit)) throw new KitError(`kit ${kit.id ?? '?'}: no "${k}"`);
    }
    if (ids.has(kit.id)) throw new KitError(`kit id ${kit.id} is repeated`);
    ids.add(kit.id);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(kit.id)) throw new KitError(`kit id ${kit.id} is not a slug`);
  }
  return m;
}

/** The fail-closed licence gate: throws unless the kit's SPDX id is allowlisted. */
export function assertLicenceAllowed(kit) {
  const spdx = kit.licence?.spdx;
  if (!ALLOWED_LICENCES.has(spdx)) {
    throw new KitError(`kit ${kit.id}: licence ${JSON.stringify(spdx)} is not on the allowlist (${[...ALLOWED_LICENCES].join(', ')}); refusing`);
  }
}

/** The licence text must state CC0 (checked on the staged file, beside its sha256 pin). */
export function assertLicenceText(kit, bytes) {
  if (!/CC0 1\.0 Universal/.test(bytes.toString('utf8'))) throw new KitError(`kit ${kit.id}: ${kit.licenceFile.path} does not state "CC0 1.0 Universal"; refusing`);
}

/** Every file under dir (recursive), after unzipping any .zip found at any depth into a scratch directory. */
function collect(dir, scratch) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.toLowerCase().endsWith('.zip')) {
        const target = mkdtempSync(join(scratch, 'zip-'));
        const r = spawnSync('unzip', ['-q', '-o', p, '-d', target], { encoding: 'utf8' });
        if (r.status !== 0) throw new KitError(`cannot unzip ${p}: ${r.stderr}`);
        walk(target);
      } else out.push(p);
    }
  };
  walk(dir);
  return out;
}

function findFile(candidates, path) {
  const exact = candidates.filter((p) => p.endsWith(`/${path}`) || p === path);
  const byName = candidates.filter((p) => basename(p) === basename(path));
  const hits = exact.length ? exact : byName;
  if (hits.length > 1) {
    const digests = new Set(hits.map((p) => sha256(readFileSync(p))));
    if (digests.size > 1) throw new KitError(`${path}: ${hits.length} different files by that name under --from (${hits.join(', ')})`);
  }
  return hits[0];
}

export function stageKit({ manifest, kitId, depsDir, from, pin, check }) {
  const kit = manifest.kits.find((k) => k.id === kitId);
  if (!kit) throw new KitError(`no kit ${kitId} in kits.json`);
  assertLicenceAllowed(kit);
  const dest = join(depsDir, kit.id);
  const scratch = mkdtempSync(join(tmpdir(), 'nr-kits-'));
  try {
    const candidates = from ? collect(from, scratch) : [];
    const stage = join(scratch, 'stage');
    mkdirSync(stage);
    const report = [];

    const entries = [{ path: kit.licenceFile.path, sha256: kit.licenceFile.sha256, licence: true }, ...kit.files.map((f) => ({ ...f }))];
    if (pin && from) {
      for (const p of candidates) {
        const name = basename(p);
        if (!KIT_EXTENSIONS.has(name.slice(name.lastIndexOf('.')).toLowerCase())) continue;
        if (!entries.some((e) => e.path === name)) entries.push({ path: name, sha256: null, size: null });
      }
    }

    for (const e of entries) {
      const staged = join(dest, e.path);
      let source = existsSync(staged) ? staged : undefined;
      if (!source && from) source = findFile(candidates, e.path);
      if (!source) {
        if (check) throw new KitError(`kit ${kit.id}: ${e.path} is not staged in ${dest}`);
        throw new KitError(`kit ${kit.id}: ${e.path} not found. Download the pack from ${kit.downloadPage} (the free "Standard" files; see kits.json acquisition) and run: tools/render/fetch-kits.sh --from <download dir>`);
      }
      const bytes = readFileSync(source);
      const digest = sha256(bytes);
      if (e.licence) assertLicenceText(kit, bytes);
      if (e.sha256 === null || e.sha256 === undefined) {
        if (!pin) throw new KitError(`kit ${kit.id}: ${e.path} has no sha256 pin in kits.json (first fetch: re-run with --pin and commit the result)`);
        e.sha256 = digest;
        e.size = bytes.length;
        e.pinned = true;
      } else if (e.sha256 !== digest) {
        throw new KitError(`kit ${kit.id}: ${e.path} sha256 ${digest} differs from the pin ${e.sha256}; refusing`);
      }
      writeFileSync(join(stage, e.path.replaceAll('/', '__')), bytes);
      report.push({ path: e.path, sha256: digest, size: bytes.length, from: source === staged ? 'deps/kits' : source, pinned: !!e.pinned });
    }

    if (!check) {
      mkdirSync(dest, { recursive: true });
      for (const r of report) {
        const out = join(dest, r.path);
        if (r.from === 'deps/kits') continue;
        mkdirSync(dirname(out), { recursive: true });
        renameSync(join(stage, r.path.replaceAll('/', '__')), out);
      }
    }

    if (pin) {
      const licence = entries.find((e) => e.licence);
      kit.licenceFile.sha256 = licence.sha256;
      kit.files = entries.filter((e) => !e.licence).map(({ pinned, ...f }) => f).sort((a, b) => a.path.localeCompare(b.path));
    }
    return report;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────────────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  const flag = (k) => argv.includes(`--${k}`);
  try {
    const depsDir = resolve(process.env.KITS_DIR ?? join(ROOT, 'deps/kits'));
    const manifestPath = resolve(process.env.KITS_JSON ?? KITS_JSON);
    const manifest = loadManifest(manifestPath);
    const only = opt('kit');
    const from = opt('from') ? resolve(opt('from')) : undefined;
    if (flag('pin') && !(from && only)) throw new KitError('--pin needs --from <dir> and --kit <id>');
    for (const kit of manifest.kits) {
      if (only && kit.id !== only) continue;
      if (!kit.files.length && !flag('pin')) {
        console.log(`${kit.id}: no files pinned yet (awaiting the first manual download; ${kit.downloadPage})`);
        continue;
      }
      const report = stageKit({ manifest, kitId: kit.id, depsDir, from, pin: flag('pin'), check: flag('check') });
      for (const r of report) console.log(`${kit.id}/${r.path}  ${r.sha256.slice(0, 12)}  ${r.size} B${r.pinned ? '  PINNED' : ''}`);
      console.log(`${kit.id}: ${kit.licence.spdx}, ${report.length} file(s) verified`);
    }
    if (flag('pin')) {
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      console.log(`wrote ${relative(ROOT, manifestPath)}`);
    }
  } catch (e) {
    if (!(e instanceof KitError)) throw e;
    console.error(`fetch-kits: ${e.message}`);
    process.exit(1);
  }
}
