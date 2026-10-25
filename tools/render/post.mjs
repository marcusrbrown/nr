#!/usr/bin/env node
// Post-processing of one nr_render.py run: raw supersampled albedo + normal frames -> colour sheet, normal sheet and
// a manifest. No dependencies beyond Node's zlib and crypto.
//
//   node tools/render/post.mjs --recipe <recipe.json> --raw <raw dir> --out <dir>
//
//   <out>/<name>.png     colour sheet (page 0; page k is <name>.<k>.png)
//   <out>/<name>-n.png   normal sheet, same layout as the colour sheet, OpenGL green-up
//   <out>/<name>.json    manifest: frame rects, pivots, durations, clips, sha256 of recipe, inputs and outputs
//
// Colour: nearest downsample (the centre sub-pixel of each supersample block, alpha cut to 0 or 255), then alpha-edge
// dilation: transparent texels beside opaque ones take a neighbour's colour (alpha stays 0).
// Normal: the opaque sub-pixels' vectors are averaged and renormalised, never averaged as colours; alpha and dilation
// are the colour sheet's.
//
// The pixel hashes (`pixelsSha256`) are the reproducibility currency: the sha256 of the raw RGBA bytes of a sheet, which
// does not depend on the deflate implementation. `sha256` is the PNG file's.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SCHEMA_PATH = join(HERE, 'recipe.schema.json');
export const PROFILE_SCHEMA_PATH = join(HERE, 'profile.schema.json');

export class PostError extends Error {}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// ── recipe validation (the subset of JSON Schema recipe.schema.json uses) ──────────────────────────────────────

export function validateRecipe(recipe, schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'))) {
  const errors = [];
  const resolveRef = (ref) => ref.slice(2).split('/').reduce((n, k) => n[k], schema);
  const typeOk = (t, v) => {
    switch (t) {
      case 'object': return v !== null && typeof v === 'object' && !Array.isArray(v);
      case 'array': return Array.isArray(v);
      case 'string': return typeof v === 'string';
      case 'boolean': return typeof v === 'boolean';
      case 'integer': return Number.isInteger(v);
      case 'number': return typeof v === 'number' && Number.isFinite(v);
      default: return false;
    }
  };
  const walk = (s, v, at) => {
    if (s.$ref) walk(resolveRef(s.$ref), v, at);
    if ('const' in s && v !== s.const) errors.push(`${at}: must be ${JSON.stringify(s.const)}`);
    if (s.enum && !s.enum.includes(v)) errors.push(`${at}: must be one of ${s.enum.join(', ')}`);
    if (s.type && !typeOk(s.type, v)) { errors.push(`${at}: must be ${s.type}`); return; }
    if (typeof v === 'string' && s.pattern && !new RegExp(s.pattern).test(v)) errors.push(`${at}: does not match ${s.pattern}`);
    if (typeof v === 'number') {
      if (s.minimum !== undefined && v < s.minimum) errors.push(`${at}: below ${s.minimum}`);
      if (s.maximum !== undefined && v > s.maximum) errors.push(`${at}: above ${s.maximum}`);
    }
    if (Array.isArray(v)) {
      if (s.minItems !== undefined && v.length < s.minItems) errors.push(`${at}: fewer than ${s.minItems} items`);
      if (s.maxItems !== undefined && v.length > s.maxItems) errors.push(`${at}: more than ${s.maxItems} items`);
      if (s.items) v.forEach((x, i) => walk(s.items, x, `${at}[${i}]`));
    }
    if (typeOk('object', v)) {
      for (const k of s.required ?? []) if (!(k in v)) errors.push(`${at}: missing "${k}"`);
      for (const [k, x] of Object.entries(v)) {
        if (s.properties && k in s.properties) walk(s.properties[k], x, `${at}.${k}`);
        else if (s.additionalProperties === false) errors.push(`${at}: unknown key "${k}"`);
        else if (s.additionalProperties && typeof s.additionalProperties === 'object') walk(s.additionalProperties, x, `${at}.${k}`);
      }
    }
  };
  walk(schema, recipe, 'recipe');
  if (schema.$id?.endsWith('recipe.schema.json') && recipe?.model && typeof recipe.model === 'object') {
    if (('parts' in recipe.model) === ('profile' in recipe.model)) errors.push('recipe.model: must have exactly one of "parts" or "profile"');
    if ('profile' in recipe.model && !('profileSha256' in recipe.model)) errors.push('recipe.model: "profile" needs "profileSha256"');
  }
  return errors;
}

// ── PNG ────────────────────────────────────────────────────────────────────────────────────────────────────────

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const u32be = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  return Buffer.concat([u32be(data.length), body, u32be(crc32(body))]);
};

/** sha256 over the data of a PNG's IHDR and IDAT chunks (the same value nr_render.py records; the Date text chunk is excluded). */
export function pngPayloadSha256(buf) {
  const h = createHash('sha256');
  for (let off = 8; off + 12 <= buf.length;) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    if (type === 'IHDR' || type === 'IDAT') h.update(buf.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  return h.digest('hex');
}

/** Decode a non-interlaced 8-bit RGB or RGBA PNG to {width, height, data: Uint8Array RGBA}. */
export function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(PNG_SIG)) throw new PostError('not a PNG');
  let off = 8, width = 0, height = 0, channels = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const [depth, colour, , , interlace] = [data[8], data[9], data[10], data[11], data[12]];
      if (depth !== 8 || (colour !== 6 && colour !== 2) || interlace !== 0) throw new PostError(`unsupported PNG (depth ${depth}, colour type ${colour}, interlace ${interlace})`);
      channels = colour === 6 ? 4 : 3;
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const ft = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (ft !== 0) throw new PostError(`PNG filter type ${ft}`);
      cur[i] = v & 0xff;
    }
    for (let x = 0; x < width; x++) {
      for (let k = 0; k < 3; k++) out[(y * width + x) * 4 + k] = cur[x * channels + k];
      out[(y * width + x) * 4 + 3] = channels === 4 ? cur[x * channels + 3] : 255;
    }
    prev.set(cur);
  }
  return { width, height, data: out };
}

export function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const ihdr = Buffer.concat([u32be(width), u32be(height), Buffer.from([8, 6, 0, 0, 0])]);
  return Buffer.concat([PNG_SIG, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ── downsample and dilate ──────────────────────────────────────────────────────────────────────────────────────

/** Nearest colour downsample of one frame: the centre sub-pixel of each ss*ss block; alpha becomes 0 or 255. */
export function downsampleColour(src, cw, ch, ss) {
  const out = new Uint8Array(cw * ch * 4);
  const c = ss >> 1;
  const sw = cw * ss;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const s = ((y * ss + c) * sw + x * ss + c) * 4;
      const o = (y * cw + x) * 4;
      if (src[s + 3] >= 128) {
        out[o] = src[s]; out[o + 1] = src[s + 1]; out[o + 2] = src[s + 2]; out[o + 3] = 255;
      }
    }
  }
  return out;
}

/** Normal downsample of one frame: unit vectors of the opaque sub-pixels are averaged and renormalised. */
export function downsampleNormal(src, cw, ch, ss) {
  const out = new Uint8Array(cw * ch * 4);
  const sw = cw * ss;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      let vx = 0, vy = 0, vz = 0, n = 0;
      for (let j = 0; j < ss; j++) {
        for (let i = 0; i < ss; i++) {
          const s = ((y * ss + j) * sw + x * ss + i) * 4;
          if (src[s + 3] < 128) continue;
          vx += src[s] / 127.5 - 1; vy += src[s + 1] / 127.5 - 1; vz += src[s + 2] / 127.5 - 1;
          n++;
        }
      }
      const o = (y * cw + x) * 4;
      const len = Math.hypot(vx, vy, vz);
      if (n === 0 || len < 1e-6) { out[o] = 128; out[o + 1] = 128; out[o + 2] = 255; continue; }
      out[o] = Math.floor((vx / len) * 127.5 + 127.5 + 0.5);
      out[o + 1] = Math.floor((vy / len) * 127.5 + 127.5 + 0.5);
      out[o + 2] = Math.floor((vz / len) * 127.5 + 127.5 + 0.5);
    }
  }
  return out;
}

const NEIGHBOURS = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];

/**
 * Alpha-edge dilation in place on a colour cell and a normal cell that share one alpha: for `passes` passes, every
 * transparent texel with a filled neighbour copies that neighbour's RGB (first in a fixed neighbour order) from both
 * cells. Alpha stays 0. Returns the number of opaque texels.
 */
export function dilatePair(colour, normal, cw, ch, passes) {
  const filled = new Uint8Array(cw * ch);
  let opaque = 0;
  for (let i = 0; i < cw * ch; i++) if (colour[i * 4 + 3] === 255) { filled[i] = 1; opaque++; }
  if (opaque === 0) return 0;
  for (let p = 0; p < passes; p++) {
    const add = [];
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const i = y * cw + x;
        if (filled[i]) continue;
        for (const [dx, dy] of NEIGHBOURS) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
          const n = ny * cw + nx;
          if (!filled[n]) continue;
          add.push([i, n]);
          break;
        }
      }
    }
    for (const [i, n] of add) {
      for (const buf of [colour, normal]) { buf[i * 4] = buf[n * 4]; buf[i * 4 + 1] = buf[n * 4 + 1]; buf[i * 4 + 2] = buf[n * 4 + 2]; }
      filled[i] = 1;
    }
  }
  return opaque;
}

// ── packing ────────────────────────────────────────────────────────────────────────────────────────────────────

/** Row-major grid layout, frames in order, pages of at most pageSize x pageSize. One layout serves both sheets. */
export function layoutFrames(count, cw, ch, pageSize) {
  const columns = Math.floor(pageSize / cw);
  const rows = Math.floor(pageSize / ch);
  if (columns < 1 || rows < 1) throw new PostError(`a ${cw}x${ch} cell does not fit a ${pageSize}x${pageSize} page`);
  const perPage = columns * rows;
  const placements = [];
  for (let i = 0; i < count; i++) {
    const inPage = i % perPage;
    placements.push({ page: Math.floor(i / perPage), x: (inPage % columns) * cw, y: Math.floor(inPage / columns) * ch });
  }
  const pages = [];
  for (let p = 0; p * perPage < count; p++) {
    const n = Math.min(perPage, count - p * perPage);
    pages.push({ width: Math.min(columns, n) * cw, height: Math.ceil(n / columns) * ch });
  }
  return { placements, pages };
}

const blit = (page, pw, cell, cw, ch, x0, y0) => {
  for (let y = 0; y < ch; y++) page.set(cell.subarray(y * cw * 4, (y + 1) * cw * 4), ((y0 + y) * pw + x0) * 4);
};

// ── the run ────────────────────────────────────────────────────────────────────────────────────────────────────

const pagePng = (name, role, k) => `${name}${k === 0 ? '' : `.${k}`}${role === 'normal' ? '-n' : ''}.png`;

/**
 * Turn a raw render directory into the sheets and manifest in outDir. The raw directory must carry the sentinel
 * (done.json) written by nr_render.py for exactly this recipe; every frame file must match the hash it records.
 */
export function postProcess({ recipePath, rawDir, outDir }) {
  const recipeBytes = readFileSync(recipePath);
  const recipe = JSON.parse(recipeBytes);
  const errors = validateRecipe(recipe);
  if (errors.length) throw new PostError(`${recipePath}: invalid recipe:\n  ${errors.join('\n  ')}`);

  const sentinelPath = join(rawDir, 'done.json');
  if (!existsSync(sentinelPath)) throw new PostError(`${rawDir}: no done.json sentinel (the render did not complete)`);
  const done = JSON.parse(readFileSync(sentinelPath, 'utf8'));
  if (done.recipeSha256 !== sha256(recipeBytes)) throw new PostError(`${rawDir}: rendered from a different recipe (sentinel ${done.recipeSha256}, recipe ${sha256(recipeBytes)})`);

  const { width: cw, height: ch } = recipe.cell;
  const ss = recipe.supersample;
  const expected = recipe.slots.reduce((n, s) => n + s.frames, 0);
  if (done.frames.length !== expected) throw new PostError(`${rawDir}: sentinel lists ${done.frames.length} frames, the recipe has ${expected}`);

  const pageSize = recipe.atlas?.pageSize ?? 2048;
  const passes = recipe.atlas?.dilate ?? 2;
  const { placements, pages } = layoutFrames(done.frames.length, cw, ch, pageSize);
  const sheets = pages.map((p) => ({
    colour: new Uint8Array(p.width * p.height * 4),
    normal: Uint8Array.from({ length: p.width * p.height * 4 }, (_, i) => (i % 4 === 0 || i % 4 === 1 ? 128 : i % 4 === 2 ? 255 : 0)),
  }));

  const slotById = new Map(recipe.slots.map((s) => [s.id, s]));
  const frames = [];
  for (const f of done.frames) {
    const read = (role, want) => {
      const file = join(rawDir, role, f.name);
      const bytes = readFileSync(file);
      if (pngPayloadSha256(bytes) !== want) throw new PostError(`frame ${f.index} (${f.slot} ${f.clipFrame}): ${file} differs from the payload hash in done.json`);
      const img = decodePng(bytes);
      if (img.width !== cw * ss || img.height !== ch * ss) throw new PostError(`frame ${f.index}: ${file} is ${img.width}x${img.height}, expected ${cw * ss}x${ch * ss}`);
      return img.data;
    };
    const colour = downsampleColour(read('albedo', f.albedoSha256), cw, ch, ss);
    const normal = downsampleNormal(read('normal', f.normalSha256), cw, ch, ss);
    const opaque = dilatePair(colour, normal, cw, ch, passes);
    for (let i = 0; i < cw * ch; i++) normal[i * 4 + 3] = colour[i * 4 + 3];
    const at = placements[f.index];
    blit(sheets[at.page].colour, pages[at.page].width, colour, cw, ch, at.x, at.y);
    blit(sheets[at.page].normal, pages[at.page].width, normal, cw, ch, at.x, at.y);
    const slot = slotById.get(f.slot);
    frames.push({
      index: f.index,
      clip: f.clip,
      clipFrame: f.clipFrame,
      page: at.page,
      rect: { x: at.x, y: at.y, w: cw, h: ch },
      pivot: { x: done.pivot.x, y: done.pivot.y },
      ms: slot.ms ?? 100,
      empty: opaque === 0,
    });
  }

  const clips = [];
  for (const slot of recipe.slots) {
    const mine = frames.filter((fr) => done.frames[fr.index].slot === slot.id);
    clips.push({ name: slot.clip, slot: slot.id, first: mine[0].index, count: mine.length, facing: slot.facing ?? 'south', ms: slot.ms ?? 100, loop: slot.loop ?? false });
  }

  const name = recipe.name;
  const stage = `${outDir}.stage`;
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  const pageRecords = pages.map((p, k) => {
    const files = {};
    for (const role of ['colour', 'normal']) {
      const png = encodePng(p.width, p.height, sheets[k][role]);
      const file = pagePng(name, role, k);
      writeFileSync(join(stage, file), png);
      files[role] = { file, sha256: sha256(png), pixelsSha256: sha256(sheets[k][role]) };
    }
    return { index: k, width: p.width, height: p.height, colour: files.colour, normal: files.normal };
  });

  verifyLayout({ frames, pages: pageRecords }, stage);

  const manifest = {
    schema: 1,
    name,
    cell: { width: cw, height: ch },
    supersample: ss,
    blender: done.blender,
    recipe: { sha256: sha256(recipeBytes) },
    ...(done.profile ? { profile: { id: done.profile.id, sha256: done.profile.sha256, kitFiles: done.profile.kitFiles } } : {}),
    inputs: done.frames.map((f) => ({ index: f.index, albedoSha256: f.albedoSha256, normalSha256: f.normalSha256 })),
    pages: pageRecords,
    frames,
    clips,
  };
  writeFileSync(join(stage, `${name}.json`), `${JSON.stringify(manifest, null, 2)}\n`);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(dirname(outDir), { recursive: true });
  renameSync(stage, outDir);
  return manifest;
}

/** The colour and normal sheets of every page have equal dimensions and every frame rect lies inside its page. */
export function verifyLayout(manifest, dir) {
  for (const pg of manifest.pages) {
    const dim = (role) => {
      const b = readFileSync(join(dir, pg[role].file));
      return [b.readUInt32BE(16), b.readUInt32BE(20)];
    };
    const c = dim('colour'), n = dim('normal');
    if (c[0] !== n[0] || c[1] !== n[1]) throw new PostError(`page ${pg.index}: colour sheet ${c.join('x')} and normal sheet ${n.join('x')} differ`);
    if (c[0] !== pg.width || c[1] !== pg.height) throw new PostError(`page ${pg.index}: sheet ${c.join('x')} differs from the manifest ${pg.width}x${pg.height}`);
  }
  for (const f of manifest.frames) {
    const pg = manifest.pages[f.page];
    if (!pg || f.rect.x < 0 || f.rect.y < 0 || f.rect.x + f.rect.w > pg.width || f.rect.y + f.rect.h > pg.height) {
      throw new PostError(`frame ${f.index} (${f.clip} ${f.clipFrame}): rect ${JSON.stringify(f.rect)} is outside page ${f.page}`);
    }
  }
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────────────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  const [recipe, raw, out] = [opt('recipe'), opt('raw'), opt('out')];
  if (!recipe || !raw || !out) { console.error('usage: post.mjs --recipe <recipe.json> --raw <raw dir> --out <dir>'); process.exit(2); }
  try {
    const m = postProcess({ recipePath: resolve(recipe), rawDir: resolve(raw), outDir: resolve(out) });
    console.log(`post: ${m.name}: ${m.frames.length} frames, ${m.pages.length} page(s), ${m.frames.filter((f) => f.empty).length} empty -> ${out}/${basename(m.name)}.json`);
  } catch (e) {
    if (!(e instanceof PostError)) throw e;
    console.error(`post: ${e.message}`);
    process.exit(1);
  }
}
