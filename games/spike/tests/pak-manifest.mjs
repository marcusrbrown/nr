// Compares the logical assets of a native .cwpak with those embedded in a cart (.wasc):
// normalized path + sha256 of the uncompressed payload. Container metadata is not part of the
// comparison: the .cwpak header, index offsets, entry flags (compression) and strings block;
// the .wasc zip entries manifest.json, cart.wasm and assets/cwfiles.txt (the lazy-load file list).
//
//   node games/spike/tests/pak-manifest.mjs <native.cwpak> <cart.wasc> [--json]
//
// Exit 0 when the two manifests are equal, 1 when they differ, 2 on a malformed input.
// Format: deps/cartwheel-engine/src/resource/cwpak.h (entry hash = FNV-1a 32 of the raw bytes).
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { inflateRawSync, zstdDecompressSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { unzipSync } = createRequire(join(ROOT, 'deps/cartwheel-engine/deps/wasmcart/package.json'))('fflate');

const FNV = (buf) => {
  let h = 0x811c9dc5;
  for (const b of buf) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h;
};
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function lz4Block(src, rawSize) {
  const out = Buffer.alloc(rawSize);
  let s = 0, d = 0;
  while (s < src.length) {
    const token = src[s++];
    let lit = token >> 4;
    if (lit === 15) { let b; do { b = src[s++]; lit += b; } while (b === 255); }
    src.copy(out, d, s, s + lit); s += lit; d += lit;
    if (s >= src.length) break;
    const off = src.readUInt16LE(s); s += 2;
    let len = token & 15;
    if (len === 15) { let b; do { b = src[s++]; len += b; } while (b === 255); }
    len += 4;
    for (let i = 0; i < len; i++, d++) out[d] = out[d - off];
  }
  if (d !== rawSize) throw new Error(`lz4: ${d} bytes out, expected ${rawSize}`);
  return out;
}

export function readCwpak(path) {
  const buf = readFileSync(path);
  if (buf.toString('latin1', 0, 8) !== 'CWPAK\r\n\x1a') throw new Error(`${path}: not a .cwpak`);
  const version = buf.readUInt32LE(8), count = buf.readUInt32LE(12);
  if (version < 1 || version > 2) throw new Error(`${path}: cwpak version ${version}`);
  const indexOffset = Number(buf.readBigUInt64LE(16)), stringsOffset = Number(buf.readBigUInt64LE(24));
  const entries = [];
  for (let i = 0; i < count; i++) {
    const o = indexOffset + 48 * i;
    const e = {
      uid: buf.readBigUInt64LE(o).toString(16).padStart(16, '0'),
      offset: Number(buf.readBigUInt64LE(o + 8)), size: Number(buf.readBigUInt64LE(o + 16)), rawSize: Number(buf.readBigUInt64LE(o + 24)),
      pathOffset: buf.readUInt32LE(o + 32), pathLen: buf.readUInt32LE(o + 36), flags: buf.readUInt32LE(o + 40), hash: buf.readUInt32LE(o + 44),
    };
    e.path = buf.toString('utf8', stringsOffset + e.pathOffset, stringsOffset + e.pathOffset + e.pathLen);
    const stored = buf.subarray(e.offset, e.offset + e.size);
    e.raw = e.flags & 1 ? inflateRawSync(stored) : e.flags & 2 ? Buffer.from(zstdDecompressSync(stored)) : e.flags & 4 ? lz4Block(stored, e.rawSize) : Buffer.from(stored);
    if (e.raw.length !== e.rawSize) throw new Error(`${path}: ${e.path}: ${e.raw.length} bytes, index says ${e.rawSize}`);
    if (FNV(e.raw) !== e.hash) throw new Error(`${path}: ${e.path}: FNV-1a 32 differs from the index hash`);
    entries.push(e);
  }
  return entries;
}

const norm = (p) => p.replace(/^res:\/\//, '').replace(/^\/+/, '');
const CONTAINER = new Set(['manifest.json', 'cart.wasm', 'assets/cwfiles.txt']);

export function manifestOfCwpak(path) {
  return Object.fromEntries(readCwpak(path).map((e) => [norm(e.path), { sha256: sha256(e.raw), bytes: e.rawSize }]).sort(([a], [b]) => (a < b ? -1 : 1)));
}

export function manifestOfWasc(path) {
  const files = unzipSync(new Uint8Array(readFileSync(path)));
  const out = {};
  for (const name of Object.keys(files).sort()) {
    if (CONTAINER.has(name) || name.endsWith('/')) continue;
    if (!name.startsWith('assets/')) throw new Error(`${path}: unexpected zip entry ${name}`);
    const raw = Buffer.from(files[name]);
    out[name.slice('assets/'.length)] = { sha256: sha256(raw), bytes: raw.length };
  }
  return out;
}

export function compareManifests(a, b) {
  const diffs = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!a[k]) diffs.push(`${k}: only in the cart`);
    else if (!b[k]) diffs.push(`${k}: only in the .cwpak`);
    else if (a[k].sha256 !== b[k].sha256) diffs.push(`${k}: sha256 ${a[k].sha256.slice(0, 12)}… (.cwpak) vs ${b[k].sha256.slice(0, 12)}… (cart)`);
  }
  return diffs;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [pak, wasc] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (!pak || !wasc) { console.error('usage: pak-manifest.mjs <native.cwpak> <cart.wasc> [--json]'); process.exit(2); }
  let a, b;
  try { a = manifestOfCwpak(pak); b = manifestOfWasc(wasc); } catch (e) { console.error(e.message); process.exit(2); }
  if (process.argv.includes('--json')) console.log(JSON.stringify({ cwpak: a, wasc: b }, null, 2));
  else for (const k of Object.keys(a)) console.log(`${a[k].sha256}  ${String(a[k].bytes).padStart(7)}  ${k}`);
  const diffs = compareManifests(a, b);
  if (diffs.length) { console.error(`FAIL manifests differ:\n  ${diffs.join('\n  ')}`); process.exit(1); }
  console.log(`ok ${Object.keys(a).length} assets equal (.cwpak vs cart)`);
}
