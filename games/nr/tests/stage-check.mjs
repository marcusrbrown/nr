// Checks of the stage captures (look-captures.mjs) that need no light model:
//
//   node games/nr/tests/stage-check.mjs --dir out/unit2/caps --hosts native,cart [--report <file.json>]
//
//   frames       hero clip steps in the state follow the manifest's durations: step = floor(tick * 1000 / (ms * 60))
//                (wrapped for a loop), at ticks 60..240 of the captures and across the idle clip's first boundary
//                (native runs at ticks 14, 15, 16: step 0, 1, 1 for idle at 250 ms); the walking hero is on a
//                different atlas frame from the idle ones
//   distinct     the hero on a walk frame and the heroes on an idle frame differ as pixels (their silhouettes
//                are not the same image) while the three idle heroes, one frame, are the same image
//   silhouette   the silhouette of each hero is the difference of nr and nr_bare (same lights, no heroes), read at 1
//                scene pixel (3 screen pixels); the far-left and far-right idle heroes' silhouette width is within 2
//                scene pixels of the centre hero's, and the centre hero's silhouette overlaps the atlas alpha
//                projected through the belt camera (IoU >= 0.8: the camera constants in look-lib.mjs match main.c)
//   upscale      every 3x3 block of the native stage capture (and of the cart's) is one colour (nearest-neighbour 3x)
//   sizes        the capture size and nr.px of each host (and of the GL state runs in captures.json): 1920x1080 with a
//                640x360 drawable at pixel_scale 3 everywhere, so native and cart present the same frame size
//   equality     the cart's stage picture against the native's: size, identical pixels or how many differ, sim state
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CAM, ROOT, camera, capBase, frameTexels, loadAtlas, project, readImage, texelWorld } from './look-lib.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const DIR = resolve(ROOT, opt('dir', 'out/unit2/caps'));
const HOSTS = opt('hosts', 'native,cart').split(',');
const state = (host, name, frames) => JSON.parse(readFileSync(`${capBase(DIR, host, name, frames)}.json`, 'utf8'));
const picture = (host, name, frames) => readImage(`${capBase(DIR, host, name, frames)}.png`);

let failed = 0;
const fail = (m) => { failed++; console.log(`FAIL ${m}`); };
const report = { frames: [], sizes: {}, silhouette: {}, upscale: null };
const atlas = loadAtlas();
const clipOf = (name) => atlas.manifest.clips.find((c) => c.name === name);
const stepAt = (clip, tick) => { const s = Math.floor((tick * 1000) / (clip.ms * 60)); return clip.loop ? s % clip.count : Math.min(s, clip.count - 1); };

// ── frames: from the captures' states, and native runs across the idle boundary ────────────────────────────────────
const idle = clipOf('idle'), walk = clipOf('walk');
for (const host of HOSTS) {
  for (const tick of [60, 120, 180, 240]) {
    const st = state(host, 'stage', tick);
    const want = [stepAt(idle, tick), stepAt(idle, tick), stepAt(idle, tick), stepAt(walk, tick)];
    const frames = [idle.first + want[0], idle.first + want[1], idle.first + want[2], walk.first + want[3]];
    const ok = JSON.stringify(st['nr.hero_step']) === JSON.stringify(want) && JSON.stringify(st['nr.hero_frame']) === JSON.stringify(frames) && st['nr.ticks'] === tick;
    report.frames.push({ host, tick, step: st['nr.hero_step'], frame: st['nr.hero_frame'], want, ok });
    if (!ok) fail(`${host} tick ${tick}: steps ${JSON.stringify(st['nr.hero_step'])} frames ${JSON.stringify(st['nr.hero_frame'])}, expected ${JSON.stringify(want)} / ${JSON.stringify(frames)}`);
    if (new Set(st['nr.hero_frame']).size !== 2) fail(`${host} tick ${tick}: expected two distinct atlas frames in play, got ${JSON.stringify(st['nr.hero_frame'])}`);
  }
}
mkdirSync(join(ROOT, 'out/unit2/boundary'), { recursive: true });
for (const tick of [14, 15, 16, 7, 8]) {
  const out = join(ROOT, 'out/unit2/boundary', `t${tick}.json`);
  const r = spawnSync('node', ['deps/cartwheel-engine/tools/run-cart.mjs', '--host', 'native', '--app', 'nr', '--frames', String(tick), '--state', out, '--input', 'games/nr/tests/input-idle.json'],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, CW_PROJECT_ROOT: ROOT, CW_TEST_GPU: process.env.CW_TEST_GPU || 'desktop' } });
  if (r.status !== 0) { fail(`boundary run at tick ${tick}: exit ${r.status}`); continue; }
  const st = JSON.parse(readFileSync(out, 'utf8'));
  const want = [stepAt(idle, tick), stepAt(walk, tick)];
  const got = [st['nr.hero_step'][0], st['nr.hero_step'][3]];
  report.frames.push({ boundary: tick, got, want });
  console.log(`tick ${tick}: idle step ${got[0]} walk step ${got[1]} (expected ${want[0]}, ${want[1]})`);
  if (got[0] !== want[0] || got[1] !== want[1]) fail(`boundary tick ${tick}: ${got} != ${want}`);
}
if (stepAt(idle, 14) !== 0 || stepAt(idle, 15) !== 1) fail('the idle boundary formula is not 0 at tick 14 and 1 at tick 15: the manifest changed');

// ── sizes ───────────────────────────────────────────────────────────────────────────────────────────────────────────
for (const host of HOSTS) {
  const img = picture(host, 'stage', 60);
  const px = state(host, 'stage', 60)['nr.px'];
  report.sizes[host] = { png: [img.w, img.h], px };
  console.log(`${host}: capture ${img.w}x${img.h}; window ${px[0]}x${px[1]} drawable ${px[2]}x${px[3]} render ${px[4]}x${px[5]} pixel_scale ${px[6]}`);
  if (px[6] !== 3 || px[2] !== 640 || px[3] !== 360) fail(`${host}: drawable ${px[2]}x${px[3]} pixel_scale ${px[6]}, expected 640x360 at 3`);
  if (img.w !== 1920 || img.h !== 1080) fail(`${host} capture is ${img.w}x${img.h}`);
}

// ── GL state runs and the cart against the native ──────────────────────────────────────────────────────────────────
{
  const caps = JSON.parse(readFileSync(join(DIR, 'captures.json'), 'utf8'));
  report.gl = caps.gl.map((r) => ({ app: r.app, native: r['native-gl'].px, cart: r['cart-gl'].px, missing: [r['native-gl'].missing, r['cart-gl'].missing] }));
  for (const r of caps.gl) for (const h of ['native-gl', 'cart-gl']) {
    const px = r[h].px;
    if (px[2] !== 640 || px[3] !== 360 || px[6] !== 3 || r[h].missing !== 0) fail(`${h} ${r.app}: drawable ${px[2]}x${px[3]} scale ${px[6]} missing ${r[h].missing}`);
  }
  console.log(`GL state runs: ${caps.gl.length} apps on native and cart, drawable 640x360 at scale 3, cw.three.missing 0`);
  const stage = caps.runs.filter((r) => r.set === 'stage').map((r) => ({ frames: r.frames, ...r.hosts.cartVsNative }));
  report.cartVsNative = stage;
  for (const r of stage) console.log(`cart vs native, stage f${r.frames}: ${r.sameSize ? (r.identical ? 'identical pixels' : `${r.differingPixels} px differ, max channel diff ${r.maxChannelDiff}`) : 'sizes differ'}; sim state ${r.simStateEqual ? 'equal' : 'DIFFERS'}`);
  for (const r of stage) if (!r.sameSize || !r.simStateEqual) fail(`cart vs native stage f${r.frames}: sameSize ${r.sameSize} simStateEqual ${r.simStateEqual}`);
}

// ── upscale ─────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const img = picture('native', 'stage', 60);
  let bad = 0;
  for (let by = 0; by < img.h / 3; by++) for (let bx = 0; bx < img.w / 3; bx++) {
    const o = (by * 3 * img.w + bx * 3) * 4;
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
      const p = ((by * 3 + y) * img.w + bx * 3 + x) * 4;
      if (img.rgba[p] !== img.rgba[o] || img.rgba[p + 1] !== img.rgba[o + 1] || img.rgba[p + 2] !== img.rgba[o + 2]) { bad++; x = y = 3; }
    }
  }
  report.upscale = { blocks: (img.w / 3) * (img.h / 3), mixedBlocks: bad };
  console.log(`native: ${bad} of ${(img.w / 3) * (img.h / 3)} 3x3 blocks are not one colour`);
  if (bad) fail(`native: ${bad} 3x3 blocks mix colours`);
}

// ── silhouettes ─────────────────────────────────────────────────────────────────────────────────────────────────────
const HEROES = [{ i: 0, x: -3.9, z: 0 }, { i: 1, x: 0, z: 0.004 }, { i: 2, x: 3.9, z: 0.008 }];
const cam = camera(0);
const idleTick = 60, idleFrame = idle.first + stepAt(idle, idleTick);
const texels = frameTexels(atlas, idleFrame);
for (const host of HOSTS) {
  const withHeroes = picture(host, 'stage', 60), bare = picture(host, 'bare', 60);
  const diff = (sx, sy) => { // scene pixel (sx, sy) differs between the two captures
    const o = (sy * 3 * withHeroes.w + sx * 3) * 4;
    return Math.abs(withHeroes.rgba[o] - bare.rgba[o]) + Math.abs(withHeroes.rgba[o + 1] - bare.rgba[o + 1]) + Math.abs(withHeroes.rgba[o + 2] - bare.rgba[o + 2]) > 6;
  };
  const rows = [];
  for (const h of HEROES) {
    // the hero's projected texel box bounds the search window, widened by 6 scene px
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const projected = new Set();
    for (const t of texels) {
      const [px, py] = project(cam, texelWorld(atlas, cam, h, t.u, t.v));
      const sx = Math.floor(px / 3), sy = Math.floor(py / 3);
      projected.add(sy * 10000 + sx);
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    let minX = Infinity, maxX = -Infinity, inter = 0, union = 0;
    for (let sy = y0 - 6; sy <= y1 + 6; sy++) for (let sx = x0 - 6; sx <= x1 + 6; sx++) {
      const d = diff(sx, sy), p = projected.has(sy * 10000 + sx);
      if (d) { minX = Math.min(minX, sx); maxX = Math.max(maxX, sx); }
      if (d && p) inter++;
      if (d || p) union++;
    }
    rows.push({ hero: h.i, x: h.x, width: maxX - minX + 1, left: minX, right: maxX, iou: inter / union });
  }
  report.silhouette[host] = rows;
  console.log(`${host}: silhouette widths (scene px) ${rows.map((r) => `${r.hero}:${r.width}`).join(' ')}; IoU with the projected atlas alpha ${rows.map((r) => r.iou.toFixed(3)).join(' ')}`);
  for (const r of [rows[0], rows[2]]) if (Math.abs(r.width - rows[1].width) > 2) fail(`${host}: hero ${r.hero} silhouette ${r.width} px wide vs centre ${rows[1].width}`);
  if (rows[1].iou < 0.8) fail(`${host}: centre hero IoU ${rows[1].iou.toFixed(3)} < 0.8`);
}

// ── distinct frames ─────────────────────────────────────────────────────────────────────────────────────────────────
{
  const host = HOSTS[0];
  const st = state(host, 'stage', 60);
  const frames = st['nr.hero_frame'];
  if (frames[0] === frames[3]) fail('the walking hero is on the idle frame');
  else console.log(`${host}: heroes 0-2 on atlas frame ${frames[0]}, hero 3 on frame ${frames[3]}`);
}

if (opt('report')) writeFileSync(resolve(ROOT, opt('report')), `${JSON.stringify(report, null, 2)}\n`);
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
