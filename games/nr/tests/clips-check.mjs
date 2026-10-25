#!/usr/bin/env node
// Checks of the committed hero atlas against its recipe, profile and the clip table in anim.c, and the contact sheets.
//
//   node games/nr/tests/clips-check.mjs [--out <dir>] [--publish <dir>]
//
//   <out>/clips-check.txt    one PASS/FAIL line per check, with the frame or clip named on a failure
//   <out>/clips-check.json   the same results plus the per-clip table (frames, duration, pages, sheet bytes) and the budget
//   <out>/contact.png        every clip of the colour sheet, one row per clip, 4x nearest, pivot marked
//   <out>/contact-normal.png the same rows of the normal sheet
//
// --publish copies clips-check.txt, clips-check.json and contact.png to <dir> (docs/evidence/combat-slice/unit3).
// Exit status 1 when any check fails. No Blender, GPU or network needed.
import { createHash } from 'node:crypto';
import { cpSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostError, decodePng, encodePng, pngPayloadSha256, verifyLayout, verifyRects } from '../../../tools/render/post.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const OUT = resolve(opt('out') ?? join(ROOT, 'out/unit3/clips-check'));
const PUBLISH = opt('publish') ? resolve(opt('publish')) : null;

const ATLAS = join(ROOT, 'games/nr/assets/atlases');
const RECIPE = join(ROOT, 'tools/render/recipes/hero.json');
const PROFILE = join(ROOT, 'tools/render/profiles/hero.json');
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
const MIB = 1024 * 1024;

// The atlas budget (docs/decisions/0002-render-pipeline-and-look.md): decoded RGBA of every colour and normal sheet of
// the three characters stays under 64 MiB. The hero's planned set is its ready clips plus the two hand-keyed ones
// (5 frames each); the grunt is allowed 25 % of the hero's planned frames and the heavy 35 %, each on one page.
const BUDGET = { totalMiB: 64, heroPlannedExtraFrames: 10, gruntShare: 0.25, heavyShare: 0.35, pageSize: 2048 };

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: Boolean(ok), detail }); };
const guard = (name, fn) => {
  try { fn(); } catch (e) { check(name, false, e instanceof PostError || e?.name === 'AssertionError' ? e.message : (e?.stack ?? String(e))); }
};

mkdirSync(OUT, { recursive: true });

const manifest = json(join(ATLAS, 'hero.json'));
const recipeBytes = readFileSync(RECIPE);
const recipe = JSON.parse(recipeBytes);
const profileBytes = readFileSync(PROFILE);
const profile = JSON.parse(profileBytes);
const { width: CW, height: CH } = manifest.cell;
const readySlots = Object.entries(profile.clips).filter(([, c]) => c.ready).map(([n]) => n);
const gapSlots = Object.entries(profile.clips).filter(([, c]) => !c.ready).map(([n]) => n);

// ── provenance: the committed files are the recipe's and the profile's output ─────────────────────────────────────
guard('provenance: manifest names this recipe and profile', () => {
  const problems = [];
  if (manifest.recipe.sha256 !== sha256(recipeBytes)) problems.push(`manifest recipe ${manifest.recipe.sha256} differs from tools/render/recipes/hero.json ${sha256(recipeBytes)}`);
  if (recipe.model.profileSha256 !== sha256(profileBytes)) problems.push('the recipe pins another profile hash: node tools/render/pin-profile.mjs tools/render/recipes/hero.json');
  if (manifest.profile.sha256 !== sha256(profileBytes)) problems.push(`manifest profile ${manifest.profile.sha256} differs from tools/render/profiles/hero.json ${sha256(profileBytes)}`);
  check('provenance: manifest names this recipe and profile', problems.length === 0, problems.join('; ') || `recipe ${sha256(recipeBytes).slice(0, 12)}, profile ${sha256(profileBytes).slice(0, 12)}`);
});

const sheets = manifest.pages.map((pg) => {
  const colourBytes = readFileSync(join(ATLAS, pg.colour.file));
  const normalBytes = readFileSync(join(ATLAS, pg.normal.file));
  return { pg, colourBytes, normalBytes, colour: decodePng(colourBytes), normal: decodePng(normalBytes) };
});

guard('provenance: sheet hashes', () => {
  const problems = [];
  for (const s of sheets) {
    for (const role of ['colour', 'normal']) {
      const rec = s.pg[role], bytes = s[`${role}Bytes`], img = s[role];
      if (sha256(bytes) !== rec.sha256) problems.push(`${rec.file}: file sha256 differs from the manifest`);
      if (sha256(img.data) !== rec.pixelsSha256) problems.push(`${rec.file}: pixel sha256 differs from the manifest`);
      if (img.width !== s.pg.width || img.height !== s.pg.height) problems.push(`${rec.file}: ${img.width}x${img.height}, manifest ${s.pg.width}x${s.pg.height}`);
      if (!rec.file || pngPayloadSha256(bytes).length !== 64) problems.push(`${rec.file}: unreadable`);
    }
  }
  check('provenance: sheet hashes', problems.length === 0, problems.join('; ') || `${sheets.length * 2} sheet(s) match the manifest`);
});

// ── the clip set ──────────────────────────────────────────────────────────────────────────────────────────────────
guard('clips: the 14 ready clips are in the atlas in recipe order, the gaps are not', () => {
  const names = manifest.clips.map((c) => c.name);
  const problems = [];
  if (readySlots.length !== 14) problems.push(`the profile has ${readySlots.length} ready clips, expected 14`);
  if (JSON.stringify(names) !== JSON.stringify(readySlots)) problems.push(`atlas clips [${names}] differ from the profile's ready clips [${readySlots}]`);
  for (const g of gapSlots) if (names.includes(g)) problems.push(`gap clip ${g} has frames`);
  if (JSON.stringify(gapSlots) !== JSON.stringify(['jumpkick', 'grab'])) problems.push(`gap clips are [${gapSlots}], expected jumpkick and grab`);
  for (const g of gapSlots) if (!profile.clips[g].handKey || profile.clips[g].segments.length) problems.push(`${g}: placeholder must name its hand-key work and carry no segments`);
  check('clips: the 14 ready clips are in the atlas in recipe order, the gaps are not', problems.length === 0, problems.join('; ') || `${names.length} clips; placeholders: ${gapSlots.join(', ')}`);
});

guard('clips: manifest clips match the recipe slots', () => {
  const problems = [];
  recipe.slots.forEach((s, i) => {
    const c = manifest.clips[i];
    if (!c || c.name !== s.clip || c.count !== s.frames || c.ms !== s.ms || c.loop !== (s.loop ?? false) || c.facing !== s.facing) {
      problems.push(`slot ${s.id}: manifest ${JSON.stringify(c)} differs from the recipe (${s.frames} frames, ${s.ms} ms, loop ${s.loop})`);
    }
  });
  if (manifest.clips.length !== recipe.slots.length) problems.push(`${manifest.clips.length} clips, ${recipe.slots.length} slots`);
  check('clips: manifest clips match the recipe slots', problems.length === 0, problems.join('; '));
});

guard('clips: anim.c names the same clips, with the gaps marked', () => {
  const src = readFileSync(join(ROOT, 'games/nr/anim.c'), 'utf8');
  const hdr = readFileSync(join(ROOT, 'games/nr/anim.h'), 'utf8');
  const table = [...src.matchAll(/\[NR_HERO_([A-Z0-9_]+)\]\s*=\s*\{\s*"([a-z0-9_]+)",\s*(true|false)\s*\}/g)].map((m) => ({ id: m[1], name: m[2], gap: m[3] === 'true' }));
  const problems = [];
  const expected = ['idle', 'walk', 'run', 'hit1', 'hit2', 'hit3', 'jump', 'jumpkick', 'grab', 'throw', 'hurt', 'knockdown', 'getup', 'dash', 'special_knockback', 'special_dash'];
  if (JSON.stringify(table.map((t) => t.name)) !== JSON.stringify(expected)) problems.push(`anim.c table [${table.map((t) => t.name)}]`);
  const enumIds = [...(hdr.match(/typedef enum \{([\s\S]*?)NR_HERO_CLIP_COUNT\s*\} nr_hero_clip;/)?.[1] ?? '').matchAll(/NR_HERO_([A-Z0-9_]+)/g)].map((m) => m[1]);
  if (JSON.stringify(enumIds) !== JSON.stringify(table.map((t) => t.id))) problems.push(`anim.h enum [${enumIds}] differs from the table ids [${table.map((t) => t.id)}]`);
  for (const t of table) {
    const inProfile = profile.clips[t.name];
    if (!inProfile) { problems.push(`${t.name}: not a profile clip`); continue; }
    if (t.gap !== !inProfile.ready) problems.push(`${t.name}: anim.c gap ${t.gap}, profile ready ${inProfile.ready}`);
    const inAtlas = manifest.clips.some((c) => c.name === t.name);
    if (t.gap === inAtlas) problems.push(`${t.name}: gap ${t.gap} but ${inAtlas ? 'the atlas has' : 'the atlas lacks'} the clip`);
  }
  if (manifest.clips.length > Number(/#define NR_MAX_CLIPS (\d+)/.exec(hdr)?.[1] ?? 0)) problems.push('more atlas clips than NR_MAX_CLIPS');
  check('clips: anim.c names the same clips, with the gaps marked', problems.length === 0, problems.join('; ') || `${table.length} slots, ${table.filter((t) => t.gap).length} gaps`);
});

// ── per frame: size, pivot, page, margins ─────────────────────────────────────────────────────────────────────────
const opaqueBox = (img, r) => {
  let x0 = r.w, x1 = -1, y0 = r.h, y1 = -1, n = 0;
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
    if (img.data[((r.y + y) * img.width + r.x + x) * 4 + 3] !== 255) continue;
    n++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return { x0, x1, y0, y1, n };
};
const boxes = manifest.frames.map((f) => opaqueBox(sheets[f.page].colour, f.rect));

guard('frames: every clip has at least 4 frames, contiguous, and every pivot is inside its rect', () => {
  const problems = [];
  let next = 0;
  for (const c of manifest.clips) {
    if (c.count < 4) problems.push(`clip ${c.name}: ${c.count} frames`);
    if (c.first !== next) problems.push(`clip ${c.name}: starts at frame ${c.first}, expected ${next}`);
    next = c.first + c.count;
    for (let i = c.first; i < c.first + c.count; i++) {
      const f = manifest.frames[i];
      const label = `frame ${f.index} (${f.clip} ${f.clipFrame})`;
      if (f.index !== i || f.clip !== c.name || f.clipFrame !== i - c.first) problems.push(`${label}: not frame ${i} of ${c.name}`);
      if (f.rect.w !== CW || f.rect.h !== CH) problems.push(`${label}: rect ${f.rect.w}x${f.rect.h}, cell ${CW}x${CH}`);
      if (!(f.pivot.x >= 0 && f.pivot.x <= f.rect.w && f.pivot.y >= 0 && f.pivot.y <= f.rect.h)) problems.push(`${label}: pivot ${JSON.stringify(f.pivot)} outside its rect`);
      if (f.pivot.x !== manifest.frames[0].pivot.x || f.pivot.y !== manifest.frames[0].pivot.y) problems.push(`${label}: pivot differs from frame 0`);
      if (f.empty || boxes[i].n === 0) problems.push(`${label}: no visible texel`);
    }
  }
  if (next !== manifest.frames.length) problems.push(`clips cover ${next} of ${manifest.frames.length} frames`);
  check('frames: every clip has at least 4 frames, contiguous, and every pivot is inside its rect', problems.length === 0, problems.join('; ') || `${manifest.clips.length} clips, ${manifest.frames.length} frames, pivot (${manifest.frames[0].pivot.x}, ${manifest.frames[0].pivot.y}) in every ${CW}x${CH} rect`);
});

guard('frames: no silhouette within 3 px of its cell edge (a clipped pose)', () => {
  const problems = [];
  boxes.forEach((b, i) => {
    const f = manifest.frames[i];
    if (b.x0 < 3 || b.y0 < 3 || b.x1 > CW - 4 || b.y1 > CH - 4) problems.push(`frame ${f.index} (${f.clip} ${f.clipFrame}): opaque texels span x ${b.x0}-${b.x1}, y ${b.y0}-${b.y1} of ${CW}x${CH}`);
  });
  const x0 = Math.min(...boxes.map((b) => b.x0)), x1 = Math.max(...boxes.map((b) => b.x1));
  check('frames: no silhouette within 3 px of its cell edge (a clipped pose)', problems.length === 0, problems.join('; ') || `all frames inside x ${x0}-${x1} of ${CW}`);
});

// ── pages and rects ───────────────────────────────────────────────────────────────────────────────────────────────
guard('pages: rects inside their pages; the multi-page placement recorded', () => {
  verifyLayout(manifest, ATLAS);
  const spilled = manifest.clips.filter((c) => new Set(manifest.frames.slice(c.first, c.first + c.count).map((f) => f.page)).size > 1);
  const detail = `${manifest.pages.length} page(s): ${manifest.pages.map((p) => `${p.index}: ${p.width}x${p.height}`).join(', ')}; clips crossing a page: ${spilled.length ? spilled.map((c) => c.name).join(', ') : 'none'}`;
  const problems = [];
  if (manifest.pages.some((p) => p.width > BUDGET.pageSize || p.height > BUDGET.pageSize)) problems.push(`a page exceeds ${BUDGET.pageSize}`);
  // games/nr/anim.c reads one sheet pair per character: a second page is a loader change, not a data change
  if (manifest.pages.length !== 1) problems.push(`${manifest.pages.length} pages: the loader in anim.c reads one`);
  check('pages: rects inside their pages; the multi-page placement recorded', problems.length === 0, problems.join('; ') || detail);
});

guard('rects: each frame\'s normal rect has its colour rect\'s alpha', () => {
  verifyRects(manifest, ATLAS);
  check('rects: each frame\'s normal rect has its colour rect\'s alpha', true, `${manifest.frames.length} frames`);
});

guard('rects: a normal rect that differs from its colour rect fails naming the frame (control)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nr-clips-'));
  try {
    cpSync(ATLAS, dir, { recursive: true });
    const n = decodePng(readFileSync(join(dir, manifest.pages[0].normal.file)));
    const a = manifest.frames[5].rect, b = manifest.frames[70].rect;
    for (let y = 0; y < a.h; y++) n.data.copyWithin(((a.y + y) * n.width + a.x) * 4, ((b.y + y) * n.width + b.x) * 4, ((b.y + y) * n.width + b.x + a.w) * 4);
    writeFileSync(join(dir, manifest.pages[0].normal.file), encodePng(n.width, n.height, n.data));
    let message = null;
    try { verifyRects(manifest, dir); } catch (e) { message = e instanceof PostError ? e.message : null; }
    const want = `frame 5 (${manifest.frames[5].clip} ${manifest.frames[5].clipFrame})`;
    check('rects: a normal rect that differs from its colour rect fails naming the frame (control)', message?.startsWith(want), message ?? 'verifyRects accepted the tampered sheet');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── budget ────────────────────────────────────────────────────────────────────────────────────────────────────────
const frameBytes = CW * CH * 4 * 2; // colour + normal
const rowsFor = (frames) => Math.ceil(frames / Math.floor(BUDGET.pageSize / CW));
const pairBytes = (frames) => Math.min(frames, Math.floor(BUDGET.pageSize / CW)) * CW * rowsFor(frames) * CH * 4 * 2;
const heroFrames = manifest.frames.length;
const heroPlanned = heroFrames + BUDGET.heroPlannedExtraFrames;
const gruntFrames = Math.ceil(heroPlanned * BUDGET.gruntShare);
const heavyFrames = Math.ceil(heroPlanned * BUDGET.heavyShare);
const actualHeroBytes = sheets.reduce((n, s) => n + s.colour.data.length + s.normal.data.length, 0);
const projected = { hero: pairBytes(heroPlanned), grunt: pairBytes(gruntFrames), heavy: pairBytes(heavyFrames) };
const projectedTotal = projected.hero + projected.grunt + projected.heavy;
const largestSheet = Math.max(...Object.values(projected).map((b) => b / 2));

guard('budget: the committed hero set and the planned three-character set fit', () => {
  const problems = [];
  if (actualHeroBytes !== pairBytes(heroFrames)) problems.push(`hero sheets are ${actualHeroBytes} bytes, the grid formula gives ${pairBytes(heroFrames)}`);
  if (projectedTotal > BUDGET.totalMiB * MIB) problems.push(`planned total ${(projectedTotal / MIB).toFixed(2)} MiB exceeds ${BUDGET.totalMiB} MiB`);
  for (const [who, frames] of [['hero', heroPlanned], ['grunt', gruntFrames], ['heavy', heavyFrames]]) {
    if (frames > Math.floor(BUDGET.pageSize / CW) * Math.floor(BUDGET.pageSize / CH)) problems.push(`${who}: ${frames} frames exceed one ${BUDGET.pageSize} page`);
  }
  check('budget: the committed hero set and the planned three-character set fit', problems.length === 0,
    problems.join('; ') || `hero ${heroFrames} frames ${(actualHeroBytes / MIB).toFixed(2)} MiB; planned hero ${heroPlanned} ${(projected.hero / MIB).toFixed(2)}, grunt ${gruntFrames} ${(projected.grunt / MIB).toFixed(2)}, heavy ${heavyFrames} ${(projected.heavy / MIB).toFixed(2)}; total ${(projectedTotal / MIB).toFixed(2)} of ${BUDGET.totalMiB} MiB`);
});

const clipTable = manifest.clips.map((c) => {
  const pagesOf = [...new Set(manifest.frames.slice(c.first, c.first + c.count).map((f) => f.page))];
  return { clip: c.name, first: c.first, frames: c.count, ms: c.ms, loop: c.loop, durationMs: c.count * c.ms, pages: pagesOf, sheetBytes: c.count * frameBytes, sheetKiB: (c.count * frameBytes) / 1024 };
});

// ── contact sheets ────────────────────────────────────────────────────────────────────────────────────────────────
const FONT = {
  a: '010 101 111 101 101', b: '110 101 110 101 110', c: '011 100 100 100 011', d: '110 101 101 101 110', e: '111 100 110 100 111',
  f: '111 100 110 100 100', g: '011 100 101 101 011', h: '101 101 111 101 101', i: '111 010 010 010 111', j: '001 001 001 101 010',
  k: '101 101 110 101 101', l: '100 100 100 100 111', m: '101 111 111 101 101', n: '110 101 101 101 101', o: '010 101 101 101 010',
  p: '110 101 110 100 100', q: '010 101 101 111 011', r: '110 101 110 101 101', s: '011 100 010 001 110', t: '111 010 010 010 010',
  u: '101 101 101 101 111', v: '101 101 101 101 010', w: '101 101 111 111 101', x: '101 101 010 101 101', y: '101 101 010 010 010',
  z: '111 001 010 100 111', 0: '111 101 101 101 111', 1: '010 110 010 010 111', 2: '110 001 010 100 111', 3: '110 001 010 001 110',
  4: '101 101 111 001 001', 5: '111 100 110 001 110', 6: '011 100 111 101 111', 7: '111 001 010 010 010', 8: '111 101 111 101 111',
  9: '111 101 111 001 110', _: '000 000 000 000 111',
};
const SCALE = 4, TEXT = 6, GAP = 4, MARGIN = 4;

function contactSheet(role) {
  const u = { x0: CW, x1: 0, y0: CH, y1: 0 };
  for (const b of boxes) { u.x0 = Math.min(u.x0, b.x0); u.x1 = Math.max(u.x1, b.x1); u.y0 = Math.min(u.y0, b.y0); u.y1 = Math.max(u.y1, b.y1); }
  const cx0 = Math.max(0, u.x0 - MARGIN), cx1 = Math.min(CW - 1, u.x1 + MARGIN), cy0 = Math.max(0, u.y0 - MARGIN), cy1 = Math.min(CH - 1, u.y1 + MARGIN);
  const cw = cx1 - cx0 + 1, ch = cy1 - cy0 + 1;
  const tile = { w: cw * SCALE + GAP, h: ch * SCALE + GAP };
  const gutter = Math.max(...manifest.clips.map((c) => c.name.length)) * 4 * TEXT + 2 * TEXT;
  const cols = Math.max(...manifest.clips.map((c) => c.count));
  const W = gutter + cols * tile.w + GAP, H = manifest.clips.length * tile.h + GAP;
  const out = new Uint8Array(W * H * 4);
  const bg = role === 'colour' ? [0x60, 0x68, 0x78] : [0x20, 0x20, 0x28];
  for (let i = 0; i < W * H; i++) { out[i * 4] = bg[0]; out[i * 4 + 1] = bg[1]; out[i * 4 + 2] = bg[2]; out[i * 4 + 3] = 255; }
  const dot = (x, y, w, h, rgb) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const o = ((y + j) * W + x + i) * 4; out[o] = rgb[0]; out[o + 1] = rgb[1]; out[o + 2] = rgb[2]; } };
  manifest.clips.forEach((c, row) => {
    const y0 = GAP + row * tile.h;
    // label
    [...c.name].forEach((ch2, k) => {
      const glyph = FONT[ch2]?.split(' ');
      if (!glyph) return;
      glyph.forEach((bits, gy) => [...bits].forEach((bit, gx) => { if (bit === '1') dot(TEXT + (k * 4 + gx) * TEXT, y0 + (tile.h - 5 * TEXT) / 2 - GAP / 2 + gy * TEXT, TEXT, TEXT, [0xf0, 0xf0, 0xf0]); }));
    });
    for (let i = 0; i < c.count; i++) {
      const f = manifest.frames[c.first + i];
      const img = sheets[f.page][role];
      const x0 = gutter + GAP + i * tile.w;
      dot(x0 - 1, y0 - 1, cw * SCALE + 2, 1, [0x30, 0x34, 0x40]); dot(x0 - 1, y0 + ch * SCALE, cw * SCALE + 2, 1, [0x30, 0x34, 0x40]);
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
        const s = ((f.rect.y + cy0 + y) * img.width + f.rect.x + cx0 + x) * 4;
        if (sheets[f.page].colour.data[s + 3] !== 255) continue;
        dot(x0 + x * SCALE, y0 + y * SCALE, SCALE, SCALE, [img.data[s], img.data[s + 1], img.data[s + 2]]);
      }
      const px = Math.round(f.pivot.x) - cx0, py = Math.round(f.pivot.y) - cy0;
      dot(x0 + (px - 1) * SCALE, y0 + (py - 1) * SCALE, 3 * SCALE, 3 * SCALE, [0xff, 0x00, 0xff]);
    }
  });
  return { width: W, height: H, png: encodePng(W, H, out), cell: { x: cx0, y: cy0, w: cw, h: ch } };
}

const contact = contactSheet('colour');
writeFileSync(join(OUT, 'contact.png'), contact.png);
const contactNormal = contactSheet('normal');
writeFileSync(join(OUT, 'contact-normal.png'), contactNormal.png);
check('contact sheets written', existsSync(join(OUT, 'contact.png')), `contact.png ${contact.width}x${contact.height}: ${manifest.clips.length} rows, ${SCALE}x nearest, cell crop (${contact.cell.x}, ${contact.cell.y}) ${contact.cell.w}x${contact.cell.h}, pivot in magenta`);

// ── report ────────────────────────────────────────────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
const report = {
  ok: failed.length === 0,
  atlas: { frames: heroFrames, cell: manifest.cell, pages: manifest.pages.map((p) => ({ index: p.index, width: p.width, height: p.height, bytes: p.width * p.height * 4 * 2 })), bytes: actualHeroBytes, mib: actualHeroBytes / MIB },
  budget: { ...BUDGET, planned: { hero: { frames: heroPlanned, bytes: projected.hero }, grunt: { frames: gruntFrames, bytes: projected.grunt }, heavy: { frames: heavyFrames, bytes: projected.heavy } }, plannedTotalBytes: projectedTotal, plannedTotalMiB: projectedTotal / MIB, largestSheetBytes: largestSheet, loadPeakMiB: (projectedTotal + largestSheet) / MIB },
  clips: clipTable,
  checks: results,
  contact: { file: 'contact.png', width: contact.width, height: contact.height, scale: SCALE, rows: manifest.clips.map((c) => c.name) },
};
writeFileSync(join(OUT, 'clips-check.json'), `${JSON.stringify(report, null, 2)}\n`);
const lines = results.map((r) => `${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.detail ? `: ${r.detail}` : ''}`);
lines.push('', `${failed.length === 0 ? 'ok' : 'FAILED'}: ${results.length - failed.length} of ${results.length} checks`);
writeFileSync(join(OUT, 'clips-check.txt'), `${lines.join('\n')}\n`);
console.log(lines.join('\n'));
console.log(`artifacts: ${OUT}`);
if (PUBLISH) {
  mkdirSync(PUBLISH, { recursive: true });
  for (const f of ['clips-check.txt', 'clips-check.json', 'contact.png']) copyFileSync(join(OUT, f), join(PUBLISH, f));
}
process.exit(failed.length === 0 ? 0 : 1);
