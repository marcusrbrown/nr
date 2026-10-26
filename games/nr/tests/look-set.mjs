// Assembles the look gate's capture set (requirement R7) as one set of pictures from one host: the native binary on WebGPU
// (Dawn on Metal, SDL's offscreen driver). The dual cart (build/cart-wgpu) in headless Chromium on WebGPU takes the same
// captures; for each, <out>/set.json records the cart's size against the native's, the number of differing pixels, and whether
// the whitelisted simulation state (games/nr/tests/brawler.mjs FIELDS) is equal. The pictures kept are the native ones.
//
//   CW_TEST_GPU=desktop node games/nr/tests/look-set.mjs [--out docs/evidence/combat-slice/look] [--work out/unit8/look] [--only name,name] [--control]
//   --only takes some of the captures (a prefix of a name selects it) and leaves set.json alone. --control takes the screens at a
//   wrong tick and requires their phase assertions to reject them.
//
// The set (file: what it shows):
//   idle-light-0/1/2   the hero idle under only neon light 0, 1 or 2 (nr_solo_*), tick 60
//   idle-all-lights    heroes idle and one walking on its own frame under the three neons (nr_stage), ticks 60 and 120
//   mid-walk           the walking hero of nr_stage at tick 180, and both players walking on the belt (scroll, tick 352)
//   scroll-*           the full belt scroll on input-scroll.json: ticks 61, 232, 352, 426, 640
//   pillar, pillar-bare  the actor behind and the actor in front of the pillar, with and without the actors drawn (tick 243)
//   grunt-*, heavy-*   the four waves played on input-waves.json: a grunt in the air (424, the thrown grunt's tick 8), the heavy
//                      winding up (935, tick 8 of its attack), the wave 4 crowd (1560: grunts, the heavy and both players), the heavy
//                      staggered (1910, tick 5 of the stagger)
//   combat-*           the moveset against real grunts and a heavy that stand still (nr_look, input-look.json): hit2 and hit3 of one combo
//                      on a grunt backed against the pillar (ticks 264 and 280, tick 8 of each state), the radius special (128, tick 18)
//                      and the dash special (49, tick 9). The hit lands on tick 4 of a combo state, when the clip is still drawing the
//                      wind-up; tick 8 is the clip's frame 2, its reach (0.86 and 1.08 units), inside the state's active ticks 4 to 12,
//                      with the grunt in its reaction. The radius special hits on tick 12 of its state, all enemies at once; tick 18
//                      (clip frame 4, the crouch with a hand to the ground) has every enemy six ticks into its reaction, pushed outward on
//                      both sides of the hero; the dash special's frame 2 is its widest, 1.19.
//                      Each is asserted from the native run's state (actor states, ticks, frames) before the picture is kept.
//   combat-radius-special-mid, combat-radius-special-p2  the radius special's shockwave while it expands: tick 13 of the state (one tick
//                      past the hit, the ring at 0.75 of the hit radius, the flash at 0.81 of its peak) for player 1 on input-look.json (tick 123),
//                      and for player 2 on input-fx-p2.json (tick 103), whose ring is cyan. combat-radius-special (tick 128, state tick 18) shows
//                      the ring at the full hit radius, 0.56 into its fade. Each asserts the ring's radius, colour scale and flash against the
//                      values the C computes from the state tick (fx-lib.mjs), and that the ring's samples on the screen carry the player's colour.
//   title, hud, upgrade, clear  the full game on input-2p-full.json: ticks 30, 1000, 700, 2164. The upgrade pause runs from tick 667 to the pick at 718;
//                      tick 700 is past the 30-tick grace period and before any pick. Each screen's phase and facts are asserted from the native run's state.
// The owner's checklist (CHECKLIST.md) stays unfilled here: it is theirs.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadAtlas, readImage } from './look-lib.mjs';
import { cartWgpu, nativeWgpu } from './capture-lib.mjs';
import { FIELDS, ROOT } from './brawler.mjs';
import { fxAt, ringOnScreen } from './fx-lib.mjs';

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
function combat(clip, state, tick, step, enemies, { sides = null } = {}) {
  return (st) => {
    const out = [], c = HERO.clips.find((k) => k.name === clip);
    if (st['nr.actor_state'][0] !== state || st['nr.actor_state_tick'][0] !== tick) out.push(`player 0 is in state ${st['nr.actor_state'][0]} tick ${st['nr.actor_state_tick'][0]}, not ${state} tick ${tick}`);
    if (st['nr.hero_frame'][0] !== c.first + step) out.push(`player 0 draws frame ${st['nr.hero_frame'][0]}, not ${clip} step ${step} (${c.first + step})`);
    for (const [actor, want] of enemies) if (st['nr.actor_state'][actor] !== want) out.push(`actor ${actor} is in state ${st['nr.actor_state'][actor]}, not ${want}`);
    if (st['nr.actor_kind'][2] !== 2 || st['nr.actor_kind'][8] !== 2) out.push('the enemies are not grunts');
    if (sides) { // an area attack: the listed enemies stand on both sides of the hero and entered their reaction on one tick
      const x = (i) => st['nr.hero_pos'][i * 3], ticks = new Set(sides.map((i) => st['nr.actor_state_tick'][i]));
      const left = sides.filter((i) => x(i) < x(0) - 0.5), right = sides.filter((i) => x(i) > x(0) + 0.5);
      if (left.length < 2 || right.length < 2) out.push(`enemies on the hero's left ${left.length}, right ${right.length}: both sides need at least 2`);
      if (ticks.size !== 1) out.push(`the enemies react on different ticks (state ticks ${[...ticks].join(', ')})`);
    }
    return out;
  };
}
/** What a shockwave capture must show: player `p` drawing the ring of tick `t` of its special state, the published radius, colour scale and
 * flash the ones fx-lib computes for that tick, and the ring on the picture in the player's colour (magenta for 0, cyan for 1). */
function ring(p, t, { minFraction = 0.4 } = {}) {
  return (st, img) => {
    const out = [], want = fxAt(t), near = (a, b) => Math.abs(a - b) <= 1e-5 * Math.max(1, Math.abs(b));
    if (st['nr.fx_radius'][p] === 0) out.push(`the ring of player ${p} is not active`);
    if (!near(st['nr.fx_radius'][p], want.radius)) out.push(`ring radius ${st['nr.fx_radius'][p]}, not ${want.radius} for tick ${t}`);
    if (!near(st['nr.fx_alpha'][p], want.scale)) out.push(`ring colour scale ${st['nr.fx_alpha'][p]}, not ${want.scale}`);
    if (!near(st['nr.fx_flash'], want.flash) || st['nr.fx_flash_player'] !== p) out.push(`flash ${st['nr.fx_flash']} at player ${st['nr.fx_flash_player']}, not ${want.flash} at ${p}`);
    if (st['nr.fx_radius'][1 - p] !== 0) out.push(`the other player's ring is active`);
    if (img) {
      const on = ringOnScreen(st, p, img);
      if (on.samples < 20) out.push(`only ${on.samples} ring samples are on the street in the frame`);
      else if (on.fraction < minFraction) out.push(`the ring's colour is on ${on.tinted} of ${on.samples} samples (${on.fraction.toFixed(2)}), under ${minFraction}`);
    }
    return out;
  };
}
const both = (...fns) => (st, img) => fns.flatMap((f) => f(st, img));
const PH = { TITLE: 0, FIGHT: 1, UPGRADE: 2, CLEAR: 3 };
/** What a screen capture must show in the native run's state: the phase (nr_phase) and the facts that tell the screen from its
 * neighbours. `facts` maps a state field to the value it must have. Returns the problems found. */
function screen(phase, facts = {}) {
  return (st) => {
    const out = [];
    if (st['nr.phase'] !== phase) out.push(`phase ${st['nr.phase']}, not ${phase}`);
    for (const [k, want] of Object.entries(facts)) if (JSON.stringify(st[k]) !== JSON.stringify(want)) out.push(`${k} is ${JSON.stringify(st[k])}, not ${JSON.stringify(want)}`);
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
  ['grunt-airborne', 'nr_waves', `${T}input-waves.json`, 424, 'wave 2: a grunt in the air'],
  ['heavy-windup', 'nr_waves', `${T}input-waves.json`, 935, 'wave 3: the heavy winding up'],
  ['wave4-crowd', 'nr_waves', `${T}input-waves.json`, 1560, 'wave 4: the crowd, grunts and the heavy with both players'],
  ['heavy-staggered', 'nr_waves', `${T}input-waves.json`, 1910, 'wave 4: the heavy staggered'],
  ['combat-hit2', 'nr_look', LOOK, 264, 'the combo: hit 2 on a real grunt, tick 8 of the state (frame 2, the extension)', combat('hit2', 4, 8, 2, [[8, ST.HURT]])],
  ['combat-hit3', 'nr_look', LOOK, 280, 'the combo: hit 3 on the same grunt, backed against the pillar, tick 8 of the state', combat('hit3', 5, 8, 2, [[8, ST.KNOCKDOWN]])],
  ['combat-radius-special', 'nr_look', LOOK, 128, 'the radius special with real grunts and the heavy on both sides of the hero, all reacting from one tick (the hit lands on tick 12), tick 18 of the state (frame 4, the crouch), the magenta shockwave ring at the full hit radius, fading', both(combat('special_knockback', 14, 18, 4, [[4, ST.STAGGER], [5, ST.HURT], [6, ST.HURT], [7, ST.HURT], [9, ST.HURT], [10, ST.HURT]], { sides: [4, 5, 6, 7, 9, 10] }), ring(0, 18))],
  ['combat-radius-special-mid', 'nr_look', LOOK, 123, 'the radius special one tick after the hit, tick 13 of the state (frame 3): the shockwave ring at 0.75 of the hit radius, the flash light near its peak, the enemies one tick into their reaction', both(combat('special_knockback', 14, 13, 3, [[4, ST.STAGGER], [5, ST.HURT], [6, ST.HURT], [7, ST.HURT], [9, ST.HURT], [10, ST.HURT]], { sides: [4, 5, 6, 7, 9, 10] }), ring(0, 13))],
  ['combat-radius-special-p2', 'nr_look', `${T}input-fx-p2.json`, 103, 'player 2 (cyan) uses the radius special, tick 13 of the state: the cyan ring at 0.75 of the hit radius, enemies on both sides one tick into their reaction', both((st) => {
    const out = [];
    if (st['nr.actor_state'][1] !== 14 || st['nr.actor_state_tick'][1] !== 13) out.push(`player 1 is in state ${st['nr.actor_state'][1]} tick ${st['nr.actor_state_tick'][1]}, not 14 tick 13`);
    const hit = [2, 3, 4, 7, 9, 10].filter((i) => [ST.HURT, ST.STAGGER].includes(st['nr.actor_state'][i]));
    if (hit.length !== 6) out.push(`${hit.length} of 6 enemies are reacting`);
    return out;
  }, ring(1, 13))],
  ['combat-dash-special', 'nr_look', LOOK, 49, 'the dash special into real grunts, tick 9 of the state (frame 2, the widest)', combat('special_dash', 15, 9, 2, [[2, ST.KNOCKDOWN]])],
  ['title', 'nr', `${T}input-2p-full.json`, 30, 'the title screen, player 1 in', screen(PH.TITLE, { 'nr.players': 1, 'nr.wave': 0 })],
  ['hud', 'nr', `${T}input-2p-full.json`, 1000, 'the fight with the HUD, wave 3, both players', screen(PH.FIGHT, { 'nr.players': 2, 'nr.wave': 3, 'nr.cleared': 0, 'nr.game_over': 0 })],
  ['upgrade', 'nr', `${T}input-2p-full.json`, 700, 'the upgrade choice screen: the pause after wave 2, 33 ticks in, no pick made', screen(PH.UPGRADE, { 'nr.pick_player': -1, 'nr.special_variant': 0, 'nr.wave': 2, 'nr.upgrade_ready': 1 })],
  ['clear', 'nr', `${T}input-2p-full.json`, 2164, 'the clear screen', screen(PH.CLEAR, { 'nr.cleared': 1, 'nr.game_over': 0, 'nr.wave': 4 })],
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

if (argv.includes('--control')) {
  // the screen assertions must reject a wrong screen: the upgrade capture taken at tick 765 (after the pick) and the title at tick 1000; the
  // shockwave captures taken after the ring is gone (tick 150) and at the full radius (128 for the mid-expansion capture)
  const wrong = [['upgrade', 765], ['title', 1000], ['clear', 1000], ['hud', 700], ['combat-radius-special', 150], ['combat-radius-special-mid', 128]];
  let bad = 0;
  for (const [name, tick] of wrong) {
    const [, app, input, , , expect] = CAPTURES.find((c) => c[0] === name);
    const r = nativeWgpu(app, join(WORK, `control-${name}`), tick, { input, inputDir: join(WORK, 'input') });
    if (r.status !== 0) { bad++; console.log(`control ${name} t${tick}: native run failed`); continue; }
    const problems = expect(readJson(join(WORK, `control-${name}.json`)), readImage(join(WORK, `control-${name}.png`)));
    console.log(`${problems.length ? 'rejected' : 'NOT REJECTED'} ${name} at tick ${tick}: ${problems.join('; ') || 'no problem found'}`);
    if (!problems.length) bad++;
  }
  console.log(bad ? `${bad} control(s) failed` : `${wrong.length} wrong-screen captures rejected`);
  process.exit(bad ? 1 : 0);
}

const set = [];
let failed = 0;
for (const [name, app, input, frames, what, expect] of CAPTURES) {
  if (ONLY.length && !ONLY.some((o) => name.startsWith(o))) continue;
  const nat = join(WORK, name), cart = join(WORK, 'cart', name);
  const rn = nativeWgpu(app, nat, frames, { input, inputDir: join(WORK, 'input') }), rc = cartWgpu(app, cart, frames, { input });
  if (rn.status !== 0 || rc.status !== 0) { failed++; console.log(`FAIL ${name}: native ${rn.status} cart ${rc.status} ${(rn.stderr || rc.stderr || '').slice(-200)}`); continue; }
  const ns = readJson(`${nat}.json`), cs = readJson(`${cart}.json`);
  const problems = expect ? expect(ns, readImage(`${nat}.png`)) : [];
  if (problems.length) { failed++; console.log(`FAIL ${name}: ${problems.join('; ')}`); continue; }
  const fields = FIELDS.filter((f) => ns[f] !== undefined);
  const simStateEqual = fields.every((f) => JSON.stringify(ns[f]) === JSON.stringify(cs[f]));
  const fxFields = Object.keys(ns).filter((f) => f.startsWith('nr.fx_')), fxStateEqual = fxFields.every((f) => JSON.stringify(ns[f]) === JSON.stringify(cs[f]));
  const px = pixels(`${nat}.png`, `${cart}.png`);
  copyFileSync(`${nat}.png`, join(OUT, `${name}.png`));
  writeFileSync(join(OUT, `${name}.json`), `${JSON.stringify(keep(ns), null, 1)}\n`);
  const row = { name, what, app, input, tick: frames, file: `${name}.png`, nativeMissing: ns['cw.three.missing'], cartMissing: cs['cw.three.missing'], cartVsNative: { ...px, simStateEqual, fieldsCompared: fields.length, fxStateEqual, fxFieldsCompared: fxFields.length } };
  if (!px.identical || !simStateEqual || !fxStateEqual || ns['cw.three.missing'] !== 0 || cs['cw.three.missing'] !== 0) failed++;
  set.push(row);
  console.log(`${name.padEnd(24)} ${app.padEnd(14)} t${String(frames).padEnd(5)} cart vs native: ${px.identical ? 'identical pixels' : `${px.differingPixels} px differ, max ${px.maxChannelDiff}`}, state ${simStateEqual ? 'equal' : 'DIFFERS'}, fx ${fxStateEqual ? 'equal' : 'DIFFERS'} (${fxFields.length}), missing ${ns['cw.three.missing']}/${cs['cw.three.missing']}`);
}
const info = { hosts: { native: 'native binary on WebGPU (Dawn on Metal, offscreen)', cart: 'build/cart-wgpu in headless Chromium on WebGPU' }, size: [1920, 1080], captures: set.length, set };
if (!ONLY.length) writeFileSync(join(OUT, 'set.json'), `${JSON.stringify(info, null, 2)}\n`);
console.log(failed ? `${failed} problem(s)` : `${set.length} captures: cart pixel-identical to native with equal state -> ${OUT}`);
process.exit(failed ? 1 : 0);
