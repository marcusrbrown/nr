// Assembles the look gate's capture set (requirement R7) as one set of pictures from one host: the native binary on WebGPU
// (Dawn on Metal, SDL's offscreen driver). The dual cart (build/cart-wgpu) in headless Chromium on WebGPU takes the same
// captures; for each, <out>/set.json records the cart's size against the native's, the number of differing pixels, and whether
// the whitelisted simulation state (games/nr/tests/brawler.mjs FIELDS) is equal. The pictures kept are the native ones.
//
//   CW_TEST_GPU=desktop node games/nr/tests/look-set.mjs [--out docs/evidence/combat-slice/look] [--work out/unit8/look] [--only name,name]
//   --only takes some of the captures (a prefix of a name selects it) and leaves set.json alone.
//
// The set (file: what it shows):
//   idle-light-0/1/2   the hero idle under only neon light 0, 1 or 2 (nr_solo_*), tick 60
//   idle-all-lights    heroes idle and one walking on its own frame under the three neons (nr_stage), ticks 60 and 120
//   mid-walk           the walking hero of nr_stage at tick 180, and both players walking on the belt (scroll, tick 352)
//   scroll-*           the full belt scroll on input-scroll.json: ticks 61, 232, 352, 426, 640
//   pillar, pillar-bare  the actor behind and the actor in front of the pillar, with and without the actors drawn (tick 243)
//   grunt-*, heavy-*   the four waves played on input-waves.json: a grunt in the air (450), the heavy winding up (990), the wave 4
//                      crowd (1600), the heavy staggered (2050)
//   combat-*           the moveset against real grunts and a heavy that stand still (nr_look, input-look.json): hit2 and hit3 of one combo
//                      on a grunt backed against the pillar (ticks 264 and 280, tick 8 of each state), the radius special (124, tick 14)
//                      and the dash special (49, tick 9). The hit lands on tick 4 of a combo state, when the clip is still drawing the
//                      wind-up; tick 8 is the clip's frame 2, its reach (0.86 and 1.08 units), inside the state's active ticks 4 to 12,
//                      with the grunt in its reaction. The radius special tests on ticks 12 to 15: tick 14 shows frame 3 (0.98 of the
//                      clip's widest 1.02, which falls after the active ticks); the dash special's frame 2 is its widest, 1.19.
//                      Each is asserted from the native run's state (actor states, ticks, frames) before the picture is kept.
//   title, hud, upgrade, clear  the full game on input-2p-full.json: ticks 30, 1000, 765, 2164
// The owner's checklist (CHECKLIST.md) stays unfilled here: it is theirs.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadAtlas, readImage } from './look-lib.mjs';
import { cartWgpu, nativeWgpu } from './capture-lib.mjs';
import { FIELDS, ROOT } from './brawler.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const OUT = resolve(ROOT, opt('out', 'docs/evidence/combat-slice/look'));
const WORK = resolve(ROOT, opt('work', 'out/unit8/look'));
const ONLY = opt('only', '')?.split(',').filter(Boolean) ?? [];
mkdirSync(OUT, { recursive: true });
mkdirSync(join(WORK, 'cart'), { recursive: true });

const T = 'games/nr/tests/';
const IDLE = `${T}input-idle.json`;
const LOOK = `${T}input-look.json`;
// nr_state (games/nr/sim.h) of the states the combat captures assert
const ST = { HURT: 10, KNOCKDOWN: 11, STAGGER: 21 };
const HERO = loadAtlas('hero').manifest;
/** What a combat capture must show in the native run's state: player 0 in `state` on tick `tick` of it, drawing `step` of the
 * clip `clip`, and each [actor, state] of the enemies reacting. Returns the problems found. */
function combat(clip, state, tick, step, enemies) {
  return (st) => {
    const out = [], c = HERO.clips.find((k) => k.name === clip);
    if (st['nr.actor_state'][0] !== state || st['nr.actor_state_tick'][0] !== tick) out.push(`player 0 is in state ${st['nr.actor_state'][0]} tick ${st['nr.actor_state_tick'][0]}, not ${state} tick ${tick}`);
    if (st['nr.hero_frame'][0] !== c.first + step) out.push(`player 0 draws frame ${st['nr.hero_frame'][0]}, not ${clip} step ${step} (${c.first + step})`);
    for (const [actor, want] of enemies) if (st['nr.actor_state'][actor] !== want) out.push(`actor ${actor} is in state ${st['nr.actor_state'][actor]}, not ${want}`);
    if (st['nr.actor_kind'][2] !== 2 || st['nr.actor_kind'][8] !== 2) out.push('the enemies are not grunts');
    return out;
  };
}
const CAPTURES = [
  ['idle-light-0', 'nr_solo_0', IDLE, 60, 'hero idle under neon light 0 only'],
  ['idle-light-1', 'nr_solo_1', IDLE, 60, 'hero idle under neon light 1 only'],
  ['idle-light-2', 'nr_solo_2', IDLE, 60, 'hero idle under neon light 2 only'],
  ['idle-all-lights-f60', 'nr_stage', IDLE, 60, 'heroes idle under the three neons, one walking on its own frame'],
  ['idle-all-lights-f120', 'nr_stage', IDLE, 120, 'the same, the lights moved'],
  ['mid-walk-stage', 'nr_stage', IDLE, 180, 'the walking hero mid-stride'],
  ['mid-walk-belt', 'nr_dummies', `${T}input-scroll.json`, 352, 'both players walking on the belt, mid-scroll'],
  ['scroll-f061', 'nr_dummies', `${T}input-scroll.json`, 61, 'belt scroll: both players at one x, the camera on them'],
  ['scroll-f232', 'nr_dummies', `${T}input-scroll.json`, 232, 'belt scroll: the trailing player at the left edge, the leader at the soft wall'],
  ['scroll-f352', 'nr_dummies', `${T}input-scroll.json`, 352, 'belt scroll: mid-scroll'],
  ['scroll-f426', 'nr_dummies', `${T}input-scroll.json`, 426, 'belt scroll: the pillar and the signs in view'],
  ['scroll-f640', 'nr_dummies', `${T}input-scroll.json`, 640, 'belt scroll: the end of the street'],
  ['pillar', 'nr_dummies', `${T}input-pillar.json`, 243, 'one player behind the pillar, a stand-in in front of it'],
  ['pillar-bare', 'nr_arena_bare', `${T}input-pillar.json`, 243, 'the same street and lights, no actors (the control for the occlusion)'],
  ['grunt-airborne', 'nr_waves', `${T}input-waves.json`, 450, 'wave 2: a grunt in the air'],
  ['heavy-windup', 'nr_waves', `${T}input-waves.json`, 990, 'wave 3: the heavy winding up'],
  ['wave4-crowd', 'nr_waves', `${T}input-waves.json`, 1600, 'wave 4: the crowd, grunts and the heavy with both players'],
  ['heavy-staggered', 'nr_waves', `${T}input-waves.json`, 2050, 'wave 4: the heavy staggered'],
  ['combat-hit2', 'nr_look', LOOK, 264, 'the combo: hit 2 on a real grunt, tick 8 of the state (frame 2, the extension)', combat('hit2', 4, 8, 2, [[8, ST.HURT]])],
  ['combat-hit3', 'nr_look', LOOK, 280, 'the combo: hit 3 on the same grunt, backed against the pillar, tick 8 of the state', combat('hit3', 5, 8, 2, [[8, ST.KNOCKDOWN]])],
  ['combat-radius-special', 'nr_look', LOOK, 124, 'the radius special among real grunts and the heavy, tick 14 of the state (frame 3)', combat('special_knockback', 14, 14, 3, [[4, ST.STAGGER], [5, ST.HURT], [6, ST.HURT], [7, ST.HURT]])],
  ['combat-dash-special', 'nr_look', LOOK, 49, 'the dash special into real grunts, tick 9 of the state (frame 2, the widest)', combat('special_dash', 15, 9, 2, [[2, ST.KNOCKDOWN]])],
  ['title', 'nr', `${T}input-2p-full.json`, 30, 'the title screen'],
  ['hud', 'nr', `${T}input-2p-full.json`, 1000, 'the fight with the HUD'],
  ['upgrade', 'nr', `${T}input-2p-full.json`, 765, 'the upgrade choice screen'],
  ['clear', 'nr', `${T}input-2p-full.json`, 2164, 'the clear screen'],
];

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const keep = (s) => Object.fromEntries(Object.entries(s).filter(([k]) => /^(nr\.|cw\.three\.|cw\.gpu\.)/.test(k) && !/^nr\.(bot_log|perf)/.test(k)));
function pixels(a, b) {
  const A = readImage(a), B = readImage(b);
  if (A.w !== B.w || A.h !== B.h) return { sameSize: false };
  let differing = 0, max = 0;
  for (let i = 0; i < A.w * A.h; i++) {
    let d = 0;
    for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(A.rgba[i * 4 + c] - B.rgba[i * 4 + c]));
    if (d) differing++;
    if (d > max) max = d;
  }
  return { sameSize: true, width: A.w, height: A.h, identical: differing === 0, differingPixels: differing, maxChannelDiff: max };
}

const set = [];
let failed = 0;
for (const [name, app, input, frames, what, expect] of CAPTURES) {
  if (ONLY.length && !ONLY.some((o) => name.startsWith(o))) continue;
  const nat = join(WORK, name), cart = join(WORK, 'cart', name);
  const rn = nativeWgpu(app, nat, frames, { input, inputDir: join(WORK, 'input') }), rc = cartWgpu(app, cart, frames, { input });
  if (rn.status !== 0 || rc.status !== 0) { failed++; console.log(`FAIL ${name}: native ${rn.status} cart ${rc.status} ${(rn.stderr || rc.stderr || '').slice(-200)}`); continue; }
  const ns = readJson(`${nat}.json`), cs = readJson(`${cart}.json`);
  const problems = expect ? expect(ns) : [];
  if (problems.length) { failed++; console.log(`FAIL ${name}: ${problems.join('; ')}`); continue; }
  const fields = FIELDS.filter((f) => ns[f] !== undefined);
  const simStateEqual = fields.every((f) => JSON.stringify(ns[f]) === JSON.stringify(cs[f]));
  const px = pixels(`${nat}.png`, `${cart}.png`);
  copyFileSync(`${nat}.png`, join(OUT, `${name}.png`));
  writeFileSync(join(OUT, `${name}.json`), `${JSON.stringify(keep(ns), null, 1)}\n`);
  const row = { name, what, app, input, tick: frames, file: `${name}.png`, nativeMissing: ns['cw.three.missing'], cartMissing: cs['cw.three.missing'], cartVsNative: { ...px, simStateEqual, fieldsCompared: fields.length } };
  if (!px.identical || !simStateEqual || ns['cw.three.missing'] !== 0 || cs['cw.three.missing'] !== 0) failed++;
  set.push(row);
  console.log(`${name.padEnd(24)} ${app.padEnd(14)} t${String(frames).padEnd(5)} cart vs native: ${px.identical ? 'identical pixels' : `${px.differingPixels} px differ, max ${px.maxChannelDiff}`}, state ${simStateEqual ? 'equal' : 'DIFFERS'}, missing ${ns['cw.three.missing']}/${cs['cw.three.missing']}`);
}
const info = { hosts: { native: 'native binary on WebGPU (Dawn on Metal, offscreen)', cart: 'build/cart-wgpu in headless Chromium on WebGPU' }, size: [1920, 1080], captures: set.length, set };
if (!ONLY.length) writeFileSync(join(OUT, 'set.json'), `${JSON.stringify(info, null, 2)}\n`);
console.log(failed ? `${failed} problem(s)` : `${set.length} captures: cart pixel-identical to native with equal state -> ${OUT}`);
process.exit(failed ? 1 : 0);
