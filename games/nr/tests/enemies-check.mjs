#!/usr/bin/env node
// Checks of the committed grunt and heavy atlases against their recipes, profiles, clip tables in anim.c and the state
// table in sim.c, the atlas budget with the real sheet sizes, and the contact sheets.
//
//   node games/nr/tests/enemies-check.mjs [--out <dir>] [--publish <dir>]
//
//   <out>/enemies-check.txt          one PASS/FAIL line per check
//   <out>/enemies-check.json         the same results, the per-clip tables and the budget
//   <out>/contact-<who>.png          every clip of the colour sheet, one row per clip
//   <out>/contact-<who>-normal.png   the same rows of the normal sheet
//
// --publish copies the .txt, .json and the colour contact sheets to <dir> (docs/evidence/combat-slice/unit6).
// Exit status 1 when any check fails. No Blender, GPU or network needed.
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostError, decodePng, pngPayloadSha256, verifyLayout, verifyRects } from '../../../tools/render/post.mjs';
import { SCALE, contactSheet, opaqueBox } from './contact-lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const OUT = resolve(opt('out') ?? join(ROOT, 'out/unit6/enemies-check'));
const PUBLISH = opt('publish') ? resolve(opt('publish')) : null;
const ATLAS = join(ROOT, 'games/nr/assets/atlases');
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
const MIB = 1024 * 1024;
const BUDGET = { totalMiB: 64, pageSize: 2048, heroPlannedFrames: 106 };

// the clips each character plays, in recipe order, and the library action each draws on (clip-audit.md)
const WHO = {
  grunt: { clips: ['idle', 'walk', 'attack', 'hurt', 'knockdown', 'getup'], actions: { idle: 'Idle_Loop', walk: 'Walk_Loop', attack: 'Punch_Jab', hurt: 'Hit_Chest', knockdown: 'Hit_Knockback', getup: 'LayToIdle' }, ticks: { attack: 'attack', hurt: 'hurt', knockdown: 'knockdown', getup: 'getup' }, allowance: 27 },
  heavy: { clips: ['idle', 'walk', 'attack', 'hurt', 'stagger'], actions: { idle: 'Idle_FoldArms_Loop', walk: 'Walk_Loop', attack: 'Melee_Hook', hurt: 'Hit_Chest', stagger: 'Hit_Head' }, ticks: { attack: 'heavy_attack', hurt: 'hurt' }, allowance: 38 },
};

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: Boolean(ok), detail }); };
const guard = (name, fn) => {
  try { fn(); } catch (e) { check(name, false, e instanceof PostError || e?.name === 'AssertionError' ? e.message : (e?.stack ?? String(e))); }
};
mkdirSync(OUT, { recursive: true });

// the state table of sim.c: name -> total ticks
const simC = readFileSync(join(ROOT, 'games/nr/sim.c'), 'utf8');
const DEF = {};
for (const m of simC.matchAll(/\[NR_ST_([A-Z_0-9]+)\] = \{ \{ "(\w+)", (\d+), (\d+), (\d+) \}/g)) DEF[m[2]] = { total: +m[3], startup: +m[4], active: +m[5] };
const animC = readFileSync(join(ROOT, 'games/nr/anim.c'), 'utf8');

const report = { characters: {}, checks: results };
const loaded = {};

for (const [who, spec] of Object.entries(WHO)) {
  const manifest = json(join(ATLAS, `${who}.json`));
  const recipePath = join(ROOT, `tools/render/recipes/${who}.json`), profilePath = join(ROOT, `tools/render/profiles/${who}.json`);
  const recipeBytes = readFileSync(recipePath), profileBytes = readFileSync(profilePath);
  const recipe = JSON.parse(recipeBytes), profile = JSON.parse(profileBytes);
  const { width: CW, height: CH } = manifest.cell;
  const label = (s) => `${who}: ${s}`;

  guard(label('provenance: manifest names this recipe and profile'), () => {
    const problems = [];
    if (manifest.recipe.sha256 !== sha256(recipeBytes)) problems.push(`manifest recipe ${manifest.recipe.sha256} differs from tools/render/recipes/${who}.json ${sha256(recipeBytes)}`);
    if (recipe.model.profileSha256 !== sha256(profileBytes)) problems.push(`the recipe pins another profile hash: node tools/render/pin-profile.mjs tools/render/recipes/${who}.json`);
    if (manifest.profile.sha256 !== sha256(profileBytes)) problems.push(`manifest profile ${manifest.profile.sha256} differs from tools/render/profiles/${who}.json`);
    check(label('provenance: manifest names this recipe and profile'), problems.length === 0, problems.join('; ') || `recipe ${sha256(recipeBytes).slice(0, 12)}, profile ${sha256(profileBytes).slice(0, 12)}`);
  });

  const sheets = manifest.pages.map((pg) => {
    const colourBytes = readFileSync(join(ATLAS, pg.colour.file)), normalBytes = readFileSync(join(ATLAS, pg.normal.file));
    return { pg, colourBytes, normalBytes, colour: decodePng(colourBytes), normal: decodePng(normalBytes) };
  });
  guard(label('provenance: sheet hashes'), () => {
    const problems = [];
    for (const s of sheets) for (const role of ['colour', 'normal']) {
      const rec = s.pg[role], bytes = s[`${role}Bytes`], img = s[role];
      if (sha256(bytes) !== rec.sha256) problems.push(`${rec.file}: file sha256 differs from the manifest`);
      if (sha256(img.data) !== rec.pixelsSha256) problems.push(`${rec.file}: pixel sha256 differs from the manifest`);
      if (img.width !== s.pg.width || img.height !== s.pg.height) problems.push(`${rec.file}: ${img.width}x${img.height}, manifest ${s.pg.width}x${s.pg.height}`);
      if (pngPayloadSha256(bytes).length !== 64) problems.push(`${rec.file}: unreadable`);
    }
    check(label('provenance: sheet hashes'), problems.length === 0, problems.join('; ') || `${sheets.length * 2} sheet(s) match the manifest`);
  });

  guard(label('clips: the atlas has the character\'s clips, in recipe order, drawn on the audited actions'), () => {
    const names = manifest.clips.map((c) => c.name), problems = [];
    if (JSON.stringify(names) !== JSON.stringify(spec.clips)) problems.push(`atlas clips [${names}], expected [${spec.clips}]`);
    recipe.slots.forEach((s, i) => {
      const c = manifest.clips[i];
      if (!c || c.name !== s.clip || c.count !== s.frames || c.ms !== s.ms || c.loop !== (s.loop ?? false) || c.facing !== s.facing) problems.push(`slot ${s.id}: manifest ${JSON.stringify(c)} differs from the recipe`);
    });
    for (const [clip, action] of Object.entries(spec.actions)) {
      const seg = profile.clips[clip]?.segments?.[0];
      if (!seg || seg.action !== action) problems.push(`${clip}: profile draws on ${seg?.action}, clip-audit.md names ${action}`);
      if (!profile.clips[clip]?.ready) problems.push(`${clip}: not ready in the profile`);
    }
    check(label('clips: the atlas has the character\'s clips, in recipe order, drawn on the audited actions'), problems.length === 0, problems.join('; ') || manifest.clips.map((c) => `${c.name} ${c.count}x${c.ms}ms`).join(', '));
  });

  guard(label('clips: anim.c names the same clips'), () => {
    const table = [...animC.matchAll(new RegExp(`\\[NR_${who.toUpperCase()}_([A-Z0-9_]+)\\]\\s*=\\s*\\{\\s*"([a-z0-9_]+)",\\s*(true|false)\\s*\\}`, 'g'))].map((m) => ({ id: m[1], name: m[2], gap: m[3] === 'true' }));
    const hdr = readFileSync(join(ROOT, 'games/nr/anim.h'), 'utf8');
    const enumIds = [...(hdr.match(new RegExp(`typedef enum \\{([\\s\\S]*?)NR_${who.toUpperCase()}_CLIP_COUNT\\s*\\} nr_${who}_clip;`))?.[1] ?? '').matchAll(new RegExp(`NR_${who.toUpperCase()}_([A-Z0-9_]+)`, 'g'))].map((m) => m[1]);
    const names = table.map((t) => t.name), problems = [];
    if (JSON.stringify(names) !== JSON.stringify(spec.clips)) problems.push(`anim.c [${names}], atlas [${spec.clips}]`);
    if (JSON.stringify(enumIds) !== JSON.stringify(table.map((t) => t.id))) problems.push(`anim.h enum [${enumIds}] differs from the table ids [${table.map((t) => t.id)}]`);
    if (table.some((t) => t.gap)) problems.push('a slot is marked as a gap');
    check(label('clips: anim.c names the same clips'), problems.length === 0, problems.join('; ') || `${table.length} slots`);
  });

  const boxes = manifest.frames.map((f) => opaqueBox(sheets[f.page].colour, f.rect));
  guard(label('frames: at least 4 per clip, contiguous, the pivot inside every rect, no silhouette within 3 px of a cell edge'), () => {
    const problems = [];
    let next = 0;
    for (const c of manifest.clips) {
      if (c.count < 4) problems.push(`clip ${c.name}: ${c.count} frames`);
      if (c.first !== next) problems.push(`clip ${c.name}: starts at frame ${c.first}, expected ${next}`);
      next = c.first + c.count;
      for (let i = c.first; i < c.first + c.count; i++) {
        const f = manifest.frames[i], b = boxes[i], at = `frame ${f.index} (${f.clip} ${f.clipFrame})`;
        if (f.rect.w !== CW || f.rect.h !== CH) problems.push(`${at}: rect ${f.rect.w}x${f.rect.h}, cell ${CW}x${CH}`);
        if (!(f.pivot.x >= 0 && f.pivot.x <= f.rect.w && f.pivot.y >= 0 && f.pivot.y <= f.rect.h)) problems.push(`${at}: pivot outside its rect`);
        if (f.empty || b.n === 0) problems.push(`${at}: no visible texel`);
        if (b.x0 < 3 || b.y0 < 3 || b.x1 > CW - 4 || b.y1 > CH - 4) problems.push(`${at}: opaque texels span x ${b.x0}-${b.x1}, y ${b.y0}-${b.y1} of ${CW}x${CH}`);
      }
    }
    if (next !== manifest.frames.length) problems.push(`clips cover ${next} of ${manifest.frames.length} frames`);
    const x0 = Math.min(...boxes.map((b) => b.x0)), x1 = Math.max(...boxes.map((b) => b.x1)), y0 = Math.min(...boxes.map((b) => b.y0));
    check(label('frames: at least 4 per clip, contiguous, the pivot inside every rect, no silhouette within 3 px of a cell edge'), problems.length === 0, problems.join('; ') || `${manifest.clips.length} clips, ${manifest.frames.length} frames of ${CW}x${CH}, pivot (${manifest.frames[0].pivot.x}, ${manifest.frames[0].pivot.y}); silhouettes inside x ${x0}-${x1}, from y ${y0}`);
  });

  guard(label('pages: one page of at most 2048 square, rects inside it, the normal rects match the colour rects'), () => {
    verifyLayout(manifest, ATLAS);
    verifyRects(manifest, ATLAS);
    const problems = [];
    if (manifest.pages.length !== 1) problems.push(`${manifest.pages.length} pages: the loader in anim.c reads one`);
    if (manifest.pages.some((p) => p.width > BUDGET.pageSize || p.height > BUDGET.pageSize)) problems.push(`a page exceeds ${BUDGET.pageSize}`);
    if (manifest.frames.length > spec.allowance) problems.push(`${manifest.frames.length} frames, the ADR-0002 allowance is ${spec.allowance}`);
    check(label('pages: one page of at most 2048 square, rects inside it, the normal rects match the colour rects'), problems.length === 0, problems.join('; ') || `${manifest.pages[0].width}x${manifest.pages[0].height}, ${manifest.frames.length} frames (allowance ${spec.allowance})`);
  });

  guard(label('state table: the sim.c lengths follow the clips'), () => {
    const problems = [], rows = [];
    for (const [clip, state] of Object.entries(spec.ticks)) {
      const c = manifest.clips.find((x) => x.name === clip), d = DEF[state];
      if (!c || !d) { problems.push(`${clip} -> ${state}: ${!c ? 'no clip' : 'no state in sim.c'}`); continue; }
      const ticks = (c.count * c.ms * 60) / 1000;
      rows.push({ clip, state, clipTicks: +ticks.toFixed(1), stateTicks: d.total });
      if (Math.abs(ticks - d.total) > 1) problems.push(`${clip} -> ${state}: the clip is ${ticks.toFixed(1)} ticks, sim.c says ${d.total}`);
    }
    check(label('state table: the sim.c lengths follow the clips'), problems.length === 0, problems.join('; ') || rows.map((r) => `${r.state} ${r.stateTicks} (clip ${r.clipTicks})`).join(', '));
  });

  const contact = contactSheet({ manifest, sheets, boxes }, 'colour');
  writeFileSync(join(OUT, `contact-${who}.png`), contact.png);
  writeFileSync(join(OUT, `contact-${who}-normal.png`), contactSheet({ manifest, sheets, boxes }, 'normal').png);
  check(label('contact sheets written'), true, `contact-${who}.png ${contact.width}x${contact.height}: ${manifest.clips.length} rows, ${SCALE}x nearest, pivot in magenta`);

  const pageBytes = manifest.pages.map((p) => ({ index: p.index, width: p.width, height: p.height, colour: p.width * p.height * 4, normal: p.width * p.height * 4 }));
  report.characters[who] = {
    frames: manifest.frames.length, cell: manifest.cell, pages: pageBytes, decodedBytes: pageBytes.reduce((n, p) => n + p.colour + p.normal, 0),
    clips: manifest.clips.map((c) => ({ clip: c.name, first: c.first, frames: c.count, ms: c.ms, loop: c.loop, durationMs: c.count * c.ms })),
    pngBytes: sheets.reduce((n, s) => n + s.colourBytes.length + s.normalBytes.length, 0),
  };
  loaded[who] = { manifest };
}

// ── budget: hero + grunt + heavy, decoded, against ADR-0002's 64 MiB ──────────────────────────────────────────────────
guard('budget: hero, grunt and heavy fit 64 MiB decoded', () => {
  const hero = json(join(ATLAS, 'hero.json'));
  const heroPage = hero.pages[0], heroBytes = heroPage.width * heroPage.height * 4 * 2;
  const cols = Math.floor(BUDGET.pageSize / hero.cell.width), plannedRows = Math.ceil(BUDGET.heroPlannedFrames / cols);
  const heroPlannedBytes = Math.min(BUDGET.heroPlannedFrames, cols) * hero.cell.width * plannedRows * hero.cell.height * 4 * 2;
  const bytes = { hero: heroBytes, grunt: report.characters.grunt.decodedBytes, heavy: report.characters.heavy.decodedBytes };
  const total = bytes.hero + bytes.grunt + bytes.heavy, planned = heroPlannedBytes + bytes.grunt + bytes.heavy;
  const largestSheet = Math.max(heroPlannedBytes, bytes.grunt, bytes.heavy) / 2;
  report.budget = { limitMiB: BUDGET.totalMiB, heroFrames: hero.frames.length, heroPlannedFrames: BUDGET.heroPlannedFrames, bytes, heroPlannedBytes, totalBytes: total, totalMiB: total / MIB, plannedBytes: planned, plannedMiB: planned / MIB, largestSheetBytes: largestSheet, loadPeakMiB: (planned + largestSheet) / MIB };
  const problems = [];
  if (planned + largestSheet > BUDGET.totalMiB * MIB) problems.push(`the load peak ${((planned + largestSheet) / MIB).toFixed(2)} MiB exceeds ${BUDGET.totalMiB} MiB`);
  if (planned > BUDGET.totalMiB * MIB) problems.push(`planned total ${(planned / MIB).toFixed(2)} MiB exceeds ${BUDGET.totalMiB} MiB`);
  const mib = (b) => (b / MIB).toFixed(2);
  check('budget: hero, grunt and heavy fit 64 MiB decoded', problems.length === 0,
    problems.join('; ') || `hero ${hero.frames.length} frames ${mib(bytes.hero)} MiB, grunt ${loaded.grunt.manifest.frames.length} frames ${mib(bytes.grunt)}, heavy ${loaded.heavy.manifest.frames.length} frames ${mib(bytes.heavy)}: total ${mib(total)} MiB; with the hero's planned ${BUDGET.heroPlannedFrames} frames ${mib(planned)} MiB; load peak (one more sheet decoding) ${mib(planned + largestSheet)} of ${BUDGET.totalMiB} MiB`);
});

const failed = results.filter((r) => !r.ok);
report.ok = failed.length === 0;
writeFileSync(join(OUT, 'enemies-check.json'), `${JSON.stringify(report, null, 2)}\n`);
const lines = results.map((r) => `${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.detail ? `: ${r.detail}` : ''}`);
lines.push('', `${failed.length === 0 ? 'ok' : 'FAILED'}: ${results.length - failed.length} of ${results.length} checks`);
writeFileSync(join(OUT, 'enemies-check.txt'), `${lines.join('\n')}\n`);
console.log(lines.join('\n'));
console.log(`artifacts: ${OUT}`);
if (PUBLISH) {
  mkdirSync(PUBLISH, { recursive: true });
  for (const f of ['enemies-check.txt', 'enemies-check.json', 'contact-grunt.png', 'contact-heavy.png']) copyFileSync(join(OUT, f), join(PUBLISH, f));
}
process.exit(failed.length === 0 ? 0 : 1);
