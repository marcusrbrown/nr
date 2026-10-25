// Depth-ordering check of the street block (AE6): the pillar that stands in the play lane occludes the actor behind it,
// and the actor in front of it occludes the pillar. Native binary on WebGPU, run on games/nr/tests/input-pillar.json.
//
//   CW_TEST_GPU=desktop node games/nr/tests/ordering-check.mjs [--out out/unit4/ordering] [--frames 243]
//        [--exe <nr binary>] [--bare-exe <nr_arena_bare binary>] [--publish docs/evidence/combat-slice/unit4]
//
// The scene is captured twice at the same tick: `nr` (the actors drawn) and `nr_arena_bare` (the same street and lights,
// no actors). For every actor and the pillar the check finds, from the state and the belt camera, the scene pixels where
// the actor's opaque texels and the pillar's front face both project, then reads the capture: an actor pixel that shows
// the bare street's colour is occluded, one that does not is visible. A pixel of an actor's silhouette away from the
// pillar must be visible, which fails the check if the projection is wrong. --exe points `nr` at the reversed-depth
// control build (cmake -DNR_REVERSE_DEPTH=ON), which must fail; the bare capture always comes from the normal build.
// Exit 0 when every assertion holds, 1 otherwise.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CAM, ROOT, camera, loadAtlas, readImage } from './look-lib.mjs';
import { nativeWgpu } from './capture-lib.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const OUT = resolve(ROOT, opt('out', 'out/unit4/ordering'));
const FRAMES = +opt('frames', 243);
const EXE = opt('exe', null), BARE_EXE = opt('bare-exe', null);
const PUBLISH = opt('publish') ? resolve(ROOT, opt('publish')) : null;
const INPUT = 'games/nr/tests/input-pillar.json';
mkdirSync(OUT, { recursive: true });

const layout = JSON.parse(readFileSync(join(ROOT, 'games/nr/assets/arena/layout.json'), 'utf8'));
const P = layout.solids.find((s) => s.id === 'pillar');
const FACE = { x0: P.x - P.w / 2, x1: P.x + P.w / 2, z: P.z + P.d / 2, y1: P.h };

const base = join(OUT, EXE ? 'control' : 'nr_dummies'), bareBase = join(OUT, 'bare');
const a = nativeWgpu('nr_dummies', base, FRAMES, { input: INPUT, exe: EXE });
const b = nativeWgpu('nr_arena_bare', bareBase, FRAMES, { input: INPUT, exe: BARE_EXE });
if (a.status !== 0 || b.status !== 0) { console.error(`capture failed: ${(a.stderr || '').slice(-300)} ${(b.stderr || '').slice(-300)}`); process.exit(1); }

const state = JSON.parse(readFileSync(`${base}.json`, 'utf8'));
const shot = readImage(`${base}.png`), bare = readImage(`${bareBase}.png`);
const W = CAM.sceneW, H = CAM.sceneH, S3 = CAM.scale;
if (shot.w !== W * S3 || bare.w !== W * S3) { console.error(`captures are ${shot.w}x${shot.h}, expected ${W * S3}x${H * S3}`); process.exit(1); }

const atlas = loadAtlas();
const { cell } = atlas.manifest, piv = atlas.manifest.frames[0].pivot;
const cam = camera(state['nr.cam_x']);
const tanH = Math.tan((CAM.fovDeg * Math.PI) / 360), aspect = W / H;
const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
const ray = (sx, sy) => {
  const nx = ((sx + 0.5) / W) * 2 - 1, ny = 1 - ((sy + 0.5) / H) * 2;
  return [0, 1, 2].map((i) => cam.fwd[i] + cam.right[i] * nx * tanH * aspect + cam.up[i] * ny * tanH);
};

const heroes = state['nr.hero_pos'].length / 3;
const actor = (i) => ({ id: i, x: state['nr.hero_pos'][i * 3], lane: state['nr.hero_pos'][i * 3 + 1], z: state['nr.hero_pos'][i * 3 + 2], frame: state['nr.hero_frame'][i], face: state['nr.actor_facing'][i] });

/** The atlas texel under the ray at scene pixel (sx, sy) for an actor's plane (facing the camera, tilted by the pitch), or null.
 * An actor facing left has its plane mirrored about its centre (the pivot's offset with it). */
function heroTexel(act, sx, sy) {
  const rightOff = (cell.width / 2 - piv.x) / CAM.ppu, upOff = (piv.y - cell.height / 2) / CAM.ppu;
  const c = [act.x + rightOff * act.face, upOff * cam.cp, act.z - upOff * cam.sp];
  const N = [0, cam.sp, cam.cp], X = [1, 0, 0], Y = [0, cam.cp, -cam.sp];
  const d = ray(sx, sy), den = dot(N, d);
  if (Math.abs(den) < 1e-9) return null;
  const t = dot(N, [c[0] - cam.pos[0], c[1] - cam.pos[1], c[2] - cam.pos[2]]) / den;
  if (t <= 0) return null;
  const p = [cam.pos[0] + d[0] * t - c[0], cam.pos[1] + d[1] * t - c[1], cam.pos[2] + d[2] * t - c[2]];
  const u = Math.floor(act.face * dot(p, X) * CAM.ppu + cell.width / 2), v = Math.floor(cell.height / 2 - dot(p, Y) * CAM.ppu);
  return u >= 0 && v >= 0 && u < cell.width && v < cell.height ? { u, v } : null;
}
const frameRect = (i) => atlas.manifest.frames[i].rect;
const alphaAt = (frame, u, v) => { const r = frameRect(frame); return atlas.colour.rgba[((r.y + v) * atlas.colour.w + r.x + u) * 4 + 3]; };
/** inside the silhouette with its whole 3x3 neighbourhood opaque: the pixel's colour does not depend on edge filtering */
function inside(act, sx, sy) {
  const t = heroTexel(act, sx, sy);
  if (!t) return false;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const u = t.u + i, v = t.v + j;
    if (u < 0 || v < 0 || u >= cell.width || v >= cell.height || alphaAt(act.frame, u, v) !== 255) return false;
  }
  return true;
}
/** the scene pixel lies on the pillar's front face */
function onFace(sx, sy, grow = 0) {
  const d = ray(sx, sy), t = (FACE.z - cam.pos[2]) / d[2];
  if (t <= 0) return false;
  const x = cam.pos[0] + d[0] * t, y = cam.pos[1] + d[1] * t;
  return x > FACE.x0 - grow && x < FACE.x1 + grow && y > -grow && y < FACE.y1 + grow;
}
const px = (img, sx, sy) => { const o = ((sy * S3 + 1) * img.w + sx * S3 + 1) * 4; return [img.rgba[o], img.rgba[o + 1], img.rgba[o + 2]]; };
const differs = (sx, sy) => { const p = px(shot, sx, sy), q = px(bare, sx, sy); return Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]), Math.abs(p[2] - q[2])) > 2; };

const acts = Array.from({ length: heroes }, (_, i) => actor(i));
const near = (act, other) => other.id !== act.id && Math.abs(other.x - act.x) < 1.6 && Math.abs(other.lane - act.lane) < 3;
const results = [];
let failed = 0;
const tint = new Uint8Array(shot.rgba);
function mark(sx, sy, rgb) { for (let j = 0; j < S3; j++) for (let i = 0; i < S3; i++) { const o = ((sy * S3 + j) * shot.w + sx * S3 + i) * 4; tint[o] = rgb[0]; tint[o + 1] = rgb[1]; tint[o + 2] = rgb[2]; } }

function record(rec) {
  results.push(rec);
  if (!rec.ok) failed++;
  console.log(`${rec.ok ? 'ok  ' : 'FAIL'} ${rec.name}: ${JSON.stringify({ ...rec, name: undefined, ok: undefined })}`);
}

// the scenario: p0 stands behind the pillar (lane < the pillar's back face), npc2 in front of it (lane > its front face)
const p0 = acts[0], npc = acts[2];
const pre = p0.lane < P.z - P.d / 2 && npc.lane > P.z + P.d / 2 && p0.x > FACE.x0 && p0.x < FACE.x1 + 1.2 && npc.x > FACE.x0 - 1 && npc.x < FACE.x1;
record({ name: 'scenario', ok: pre, p0: { x: p0.x, lane: p0.lane, z: p0.z }, npc2: { x: npc.x, lane: npc.lane, z: npc.z }, camX: state['nr.cam_x'], pillar: FACE });

for (const [who, act, expectVisible] of [['p0', p0, false], ['npc2', npc, true]]) {
  const others = acts.filter((o) => near(act, o));
  let overlap = 0, shown = 0, away = 0, awayShown = 0;
  for (let sy = 0; sy < H; sy++) for (let sx = 0; sx < W; sx++) {
    if (!inside(act, sx, sy)) continue;
    if (others.some((o) => inside(o, sx, sy))) continue; // covered by a third actor: not this pair's business
    if (onFace(sx, sy)) {
      overlap++;
      const vis = differs(sx, sy);
      if (vis) shown++;
      mark(sx, sy, vis ? [0, 255, 0] : [255, 0, 255]);
    } else if (!onFace(sx, sy, 0.12)) {
      away++;
      if (differs(sx, sy)) awayShown++;
    }
  }
  const share = overlap ? shown / overlap : 0, awayShare = away ? awayShown / away : 0;
  record({ name: `${who} against the pillar`, ok: pre && overlap > 150 && (expectVisible ? share >= 0.95 : share <= 0.02), expect: expectVisible ? 'actor in front of the pillar' : 'pillar in front of the actor', overlapPixels: overlap, actorShare: +share.toFixed(3) });
  record({ name: `${who} away from the pillar`, ok: away > 40 && awayShare >= 0.85, silhouettePixels: away, visibleShare: +awayShare.toFixed(3), note: 'the projection finds the actor where the picture has it' });
}

const { writePng } = await import(join(ROOT, 'deps/cartwheel-engine/tools/lib/png.mjs'));
writePng(`${base}-overlap.png`, shot.w, shot.h, tint, {});
writeFileSync(join(OUT, EXE ? 'control.json' : 'result.json'), `${JSON.stringify({ exe: EXE, frames: FRAMES, input: INPUT, failed, results }, null, 1)}\n`);
if (PUBLISH && !EXE) {
  mkdirSync(PUBLISH, { recursive: true });
  copyFileSync(`${base}-overlap.png`, join(PUBLISH, 'ordering-overlap.png'));
  copyFileSync(join(OUT, 'result.json'), join(PUBLISH, 'ordering-result.json'));
}
console.log(failed ? `FAIL: ${failed} assertion(s) failed` : 'PASS: the pillar occludes the actor behind it and the actor in front occludes the pillar');
process.exit(failed ? 1 : 0);
