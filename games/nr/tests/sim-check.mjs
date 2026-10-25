// Checks of the combat simulation (games/nr/sim.c) on the native binary, run on the two-player script
// games/nr/tests/input-combat.json (written by gen-input-combat.mjs).
//
//   CW_TEST_GPU=desktop node games/nr/tests/sim-check.mjs [--out out/unit5/sim] [--publish docs/evidence/combat-slice/unit5]
//
// Method. The app publishes every actor's position, jump, state, hp and the rest (nr.*), and an event log of every state
// entry, hit, grab, throw, landing and skipped hit (nr.events: tick, kind, actor, a, b). The check runs the script to its
// end for the log and to chosen ticks for the positions and states at those moments, and states each expectation from the
// script's own presses (the first frame of each hold in input-combat.json) and the state table in sim.c, not from numbers
// typed here. Each scenario below records ok or FAIL with its detail; sim-report.json holds the data.
//
//   combo              hit1 -> hit2 -> hit3 on presses in the recovery windows; hit3 knocks down; hp
//   late press         a press in a swing's active ticks does not chain; a press after the swing restarts at hit1
//   knockback          the victim's speed decays tick by tick to 0 over the hit's knockback ticks
//   grab and throw     grab on a grabbable dummy -> throw -> arc -> landing and knockdown, hp, ticks
//   grab fails         grab on the dummy that cannot be grabbed: logged, no throw, the hero recovers in the table's ticks
//   jump kick          the kick on the way down connects on its first active tick, once
//   radius special     every dummy within the radius is hit once on the first active tick and pushed; none outside is
//   dash special       the hero moves N units and hits each dummy on the path once
//   pillar             a dummy pushed at the pillar stops at its rectangle (the pillar blocks every actor)
//   friendly fire      a swing over the other player is logged and does nothing
//   hero hurt          hurt, the invulnerability it gives (a second swing is skipped), knockdown, getup
//   movement           walk, run on a double tap, dash, plain jump (the jump clip's length), facing
//   state table        every state's length follows its clip's frames x ms
//   determinism        the same script twice: the whole whitelist and the screenshot byte-identical
//   input shift        the script one tick late: the checksum diverges (the control for the gate)
//   whitelist          every published field is there with its size; hp, lives, wave, rng as expected; no dropped events
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { nativeWgpu } from './capture-lib.mjs';
import { ROOT } from './look-lib.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const OUT = resolve(ROOT, opt('out', 'out/unit5/sim'));
const PUBLISH = opt('publish') ? resolve(ROOT, opt('publish')) : null;
const INPUT = 'games/nr/tests/input-combat.json';
const FULL = 760;
mkdirSync(join(OUT, 'input'), { recursive: true });

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const results = [];
let failed = 0;
function record(name, ok, detail, data = {}) {
  results.push({ name, ok, detail, ...data });
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${detail}`);
}
const near = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;

// ── what the check reads from the source ────────────────────────────────────────────────────────────────────────────
const simH = readFileSync(join(ROOT, 'games/nr/sim.h'), 'utf8'), simC = readFileSync(join(ROOT, 'games/nr/sim.c'), 'utf8');
const enumNames = (src, type, prefix, first = 0) => [...src.match(new RegExp(`typedef enum \\{([\\s\\S]*?)\\} ${type};`))[1].matchAll(new RegExp(`${prefix}([A-Z_0-9]+)`, 'g'))].map((m, i) => [m[1], first + i]);
const STATE_IDS = Object.fromEntries(enumNames(simH, 'nr_state', 'NR_ST_').filter(([n]) => n !== 'COUNT'));
const KIND_IDS = Object.fromEntries(enumNames(simH, 'nr_event_kind', 'NR_EV_', 1));
const STATE_NAME = Object.fromEntries(Object.entries(STATE_IDS).map(([n, i]) => [i, n.toLowerCase()]));
const DEF = {};
for (const m of simC.matchAll(/\[NR_ST_([A-Z_0-9]+)\] = \{ \{ "(\w+)", (\d+), (\d+), (\d+) \}/g)) DEF[m[1]] = { name: m[2], total: +m[3], startup: +m[4], active: +m[5] };
const num = (name) => +simC.match(new RegExp(`#define ${name} ([0-9.]+)f?`))[1];
const S = (name) => STATE_IDS[name];
const hero = readJson(join(ROOT, 'games/nr/assets/atlases/hero.json'));

// the presses of the script: the first frame of every hold of a button, per player
const script = readJson(join(ROOT, INPUT));
const presses = { p0: {}, p1: {} };
{
  let prev = { p0: new Set(), p1: new Set() };
  for (const e of script) {
    for (const [who, list] of [['p0', e.buttons], ['p1', e.pad2.buttons]]) {
      for (const b of list) if (!prev[who].has(b)) (presses[who][b] ??= []).push(e.frame);
      prev[who] = new Set(list);
    }
  }
}
const P0 = presses.p0, P1 = presses.p1;

// ── runs ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const cache = new Map();
function run(ticks, input = INPUT, tag = 'main') {
  const key = `${tag}-${ticks}`;
  if (cache.has(key)) return cache.get(key);
  const base = join(OUT, `${tag}-t${ticks}`);
  const r = nativeWgpu('nr', base, ticks, { input, inputDir: join(OUT, 'input') });
  if (r.status !== 0) throw new Error(`run to tick ${ticks}: ${(r.stderr || r.stdout || '').slice(-300)}`);
  const st = readJson(`${base}.json`);
  const out = { base, st };
  cache.set(key, out);
  return out;
}
const at = (t) => run(t).st;
const actor = (t, i) => {
  const st = at(t);
  return { x: st['nr.hero_pos'][i * 3], lane: st['nr.hero_pos'][i * 3 + 1], y: st['nr.actor_y'][i], vy: st['nr.actor_vy'][i], state: STATE_NAME[st['nr.actor_state'][i]], tick: st['nr.actor_state_tick'][i],
    hp: st['nr.actor_hp'][i], facing: st['nr.actor_facing'][i], invuln: st['nr.actor_invuln'][i] };
};
const decode = (st) => {
  const e = st['nr.events'], kinds = Object.fromEntries(Object.entries(KIND_IDS).map(([n, v]) => [v, n]));
  return Array.from({ length: st['nr.event_count'] }, (_, i) => {
    const [tick, k, who, a, b] = e.slice(i * 5, i * 5 + 5);
    return { tick, kind: kinds[k], actor: who, a: k === KIND_IDS.ENTER ? STATE_NAME[a] : a, b };
  });
};

const full = run(FULL);
const events = decode(full.st);
const ev = (kind, actorId, pred = () => true) => events.filter((e) => e.kind === kind && e.actor === actorId && pred(e));
const enters = (actorId, state) => ev('ENTER', actorId, (e) => e.a === state);
const hits = (from, to) => ev('HIT', from, (e) => e.a === to);
const D = { stand: 2, combo: 3, ungrab: 4, near: 5, pillar: 6, striker: 7, path: 8 };

// the dummy layout the script is written against
{
  const want = { [D.stand]: [11.7, 1.35, 99, -1], [D.combo]: [2.4, 0.6, 12, -1], [D.ungrab]: [5.2, 0.6, 12, -1], [D.near]: [8.0, 0.6, 12, -1], [D.pillar]: [9.6, 0.4, 12, -1], [D.striker]: [-3.4, -0.6, 99, 1], [D.path]: [10.0, 1.4, 12, -1] };
  const bad = Object.entries(want).filter(([i, [x, lane, hp, f]]) => { const a = actor(1, +i); return !(near(a.x, x, 0.07) && near(a.lane, lane, 0.07) && a.hp === hp && a.facing === f); });
  record('layout', !bad.length && at(1)['nr.actor_team'].join() === '0,0,1,1,1,1,1,1,1', `heroes on team 0, ${Object.keys(want).length} dummies on team 1 at the layout main.c sets`, { bad });
}

// ── combo ───────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const [p1, p2, p3] = P0.west, h1 = DEF.HIT1, h2 = DEF.HIT2;
  const e1 = enters(0, 'hit1').find((e) => e.tick === p1), e2 = enters(0, 'hit2').find((e) => e.tick === p2), e3 = enters(0, 'hit3').find((e) => e.tick === p3);
  const windowOk = p2 - p1 >= h1.startup + h1.active && p2 - p1 < h1.total && p3 - p2 >= h2.startup + h2.active && p3 - p2 < h2.total;
  const want = [[p1 + h1.startup, 1, 'hurt'], [p2 + h2.startup, 1, 'hurt'], [p3 + DEF.HIT3.startup, 2, 'knockdown']];
  const got = want.map(([t, dmg]) => hits(0, D.combo).find((e) => e.tick === t && e.b === dmg));
  const enteredAfter = want.map(([t, , s]) => enters(D.combo, s).some((e) => e.tick === t));
  const hp = actor(want[2][0] + 1, D.combo).hp;
  record('combo', !!(e1 && e2 && e3) && windowOk && got.every(Boolean) && enteredAfter.every(Boolean) && hp === 12 - 4,
    `hit1 at ${p1}, hit2 at ${p2} (${p2 - p1} ticks in; window ${h1.startup + h1.active}..${h1.total - 1}), hit3 at ${p3}; hits on the dummy at ${want.map((w) => w[0])} for 1, 1, 2 hp; it ends knocked down with hp ${hp}`, { presses: [p1, p2, p3], hits: got });
}

// ── late press ──────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const [a, active, late] = P0.west.slice(3, 6), h1 = DEF.HIT1;
  const idleAt = a + h1.total;
  const chained = enters(0, 'hit2').filter((e) => e.tick > a && e.tick < late + h1.total);
  const first = enters(0, 'hit1').some((e) => e.tick === a), restart = enters(0, 'hit1').some((e) => e.tick === late), idle = ev('ENTER', 0, (e) => e.a === 'idle' && e.tick === idleAt).length === 1;
  const inActive = active - a >= h1.startup && active - a < h1.startup + h1.active;
  record('late press', first && restart && idle && !chained.length && inActive && late >= idleAt,
    `hit1 at ${a}; a press at ${active} (tick ${active - a}, in the active ticks ${h1.startup}..${h1.startup + h1.active - 1}) does not chain; the swing ends at ${idleAt}; a press at ${late} starts hit1 again; no hit2 in between`, { presses: [a, active, late] });
}

// ── knockback decay ─────────────────────────────────────────────────────────────────────────────────────────────────
{
  const t0 = P0.west[0] + DEF.HIT1.startup, ticks = Array.from({ length: 9 }, (_, i) => t0 + i);
  const xs = ticks.map((t) => actor(t, D.combo).x), dx = xs.slice(1).map((x, i) => x - xs[i]);
  const total = dx.reduce((s, v) => s + v, 0), decreasing = dx.slice(0, 6).every((v, i) => v > 0 && (i === 0 || v < dx[i - 1])) && dx.slice(6).every((v) => near(v, 0, 1e-6));
  record('knockback', decreasing && near(total, 0.21, 2e-3), `the victim of hit1 moves ${dx.slice(0, 7).map((v) => v.toFixed(3)).join(', ')} units on the ticks after the hit (a strictly falling speed to 0), ${total.toFixed(3)} in all`, { dx });
}

// ── grab and throw ──────────────────────────────────────────────────────────────────────────────────────────────────
{
  const g = P0.east[0], gt = g + DEF.GRAB.startup, release = gt + 10;
  const grab = ev('GRAB', 0, (e) => e.a === D.combo && e.tick === gt).length === 1, enterThrow = enters(0, 'throw').some((e) => e.tick === gt), grabbed = enters(D.combo, 'grabbed').some((e) => e.tick === gt);
  const rel = ev('RELEASE', 0, (e) => e.a === D.combo && e.tick === release).length === 1, thrown = enters(D.combo, 'thrown').some((e) => e.tick === release);
  const land = ev('LAND', D.combo)[0];
  const kd = land && enters(D.combo, 'knockdown').some((e) => e.tick === land.tick);
  const before = actor(gt - 1, D.combo), launch = actor(release, D.combo), peak = actor(release + 14, D.combo), after = land ? actor(land.tick, D.combo) : null;
  const flight = land ? land.tick - release : -1;
  const heroIdle = ev('ENTER', 0, (e) => e.a === 'idle' && e.tick === gt + DEF.THROW.total).length === 1;
  record('grab and throw', grab && enterThrow && grabbed && rel && thrown && !!land && kd && flight >= 25 && flight <= 45 && peak.y > 0.6 && after.y === 0 && after.state === 'knockdown' && after.hp === before.hp - 2 && after.x - launch.x > 2.5 && heroIdle,
    `grab at ${g} takes the dummy at ${gt} (hp ${before.hp}), the throw state holds it until ${release}, it flies ${flight} ticks (peak ${peak.y.toFixed(2)} high, ${(after.x - launch.x).toFixed(2)} units on), lands at ${land?.tick} taking 2 (hp ${after.hp}) and is knocked down; the hero is idle at ${gt + DEF.THROW.total}`,
    { grab: g, release, land: land?.tick, flight });
}

// ── grab on the dummy that cannot be grabbed ────────────────────────────────────────────────────────────────────────
{
  const g = P0.east[1], gt = g + DEF.GRAB.startup;
  const fail = ev('GRAB_FAIL', 0, (e) => e.a === D.ungrab && e.tick === gt).length === 1;
  const noGrab = !ev('GRAB', 0, (e) => e.tick >= g && e.tick < g + DEF.GRAB.total).length && !enters(0, 'throw').some((e) => e.tick >= g && e.tick < g + DEF.GRAB.total) && !enters(D.ungrab, 'grabbed').length;
  const recovered = ev('ENTER', 0, (e) => e.a === 'idle' && e.tick === g + DEF.GRAB.total).length === 1;
  const dummy = actor(g + DEF.GRAB.total, D.ungrab);
  record('grab fails', fail && noGrab && recovered && dummy.hp === 12 && dummy.state === 'idle', `grab at ${g}: the dummy that cannot be grabbed is found at ${gt} (grab-fail logged), no grab and no throw, the hero is idle again at ${g + DEF.GRAB.total} (the table's ${DEF.GRAB.total} ticks), the dummy keeps hp ${dummy.hp}`, { grab: g });
}

// ── jump kick ───────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const j = P0.south[0], k = P0.west[6], kt = k + DEF.JUMPKICK.startup;
  const kickEntry = enters(0, 'jumpkick').find((e) => e.tick === k), pre = actor(k - 1, 0), onKick = actor(k, 0);
  const landAt = ev('ENTER', 0, (e) => e.a === 'idle' && e.tick > k)[0]?.tick;
  const connect = hits(0, D.ungrab).filter((e) => e.tick >= k && e.tick <= landAt);
  const first = connect[0];
  record('jump kick', !!kickEntry && pre.vy < 0 && onKick.state === 'jumpkick' && connect.length === 1 && first.tick === kt && first.b === 2 && landAt > kt,
    `jump at ${j}, kick at ${k} on the way down (vy ${pre.vy.toFixed(3)}, ${onKick.y.toFixed(2)} high); one hit on the dummy, on the first active tick ${kt} (kick tick ${DEF.JUMPKICK.startup}), for 2; the kick lasts to the landing at ${landAt} and meets nobody twice`, { jump: j, kick: k, connect });
}

// ── radius special ──────────────────────────────────────────────────────────────────────────────────────────────────
const R = 2.4;
{
  const s = P0.north[0], t = s + DEF.SPECIAL_KNOCKBACK.startup, before = (i) => actor(t - 1, i), h0 = before(0);
  const dummies = Object.values(D);
  const inside = dummies.filter((i) => (before(i).x - h0.x) ** 2 + (before(i).lane - h0.lane) ** 2 <= R * R);
  const hitIds = ev('HIT', 0, (e) => e.tick >= t && e.tick < t + DEF.SPECIAL_KNOCKBACK.active).map((e) => e.a);
  const exact = JSON.stringify([...hitIds].sort()) === JSON.stringify([...inside].sort()) && new Set(hitIds).size === hitIds.length;
  const outside = dummies.filter((i) => !inside.includes(i)), outsideStill = outside.every((i) => { const a = before(i), b = actor(t + 25, i); return a.x === b.x && a.lane === b.lane && a.hp === b.hp; });
  const pushed = inside.map((i) => ({ id: i, from: Math.hypot(before(i).x - h0.x, before(i).lane - h0.lane), to: Math.hypot(actor(t + 25, i).x - h0.x, actor(t + 25, i).lane - h0.lane), state: actor(t, i).state }));
  const away = pushed.every((p) => p.to > p.from + 0.3 && p.state === 'hurt');
  const teammate = ev('SKIP_TEAM', 0, (e) => e.tick === t).length === (h0 && (Math.hypot(actor(t - 1, 1).x - h0.x, actor(t - 1, 1).lane - h0.lane) <= R ? 1 : 0));
  record('radius special', inside.length >= 3 && exact && outside.length >= 2 && outsideStill && away && teammate,
    `special at ${s}: on its first active tick ${t} the ${inside.length} dummies within ${R} units (${inside.map((i) => `a${i}`)}) are each hit once for 1 and pushed away (${pushed.map((p) => `${p.from.toFixed(2)}->${p.to.toFixed(2)}`).join(', ')}); the ${outside.length} outside (${outside.map((i) => `a${i}`)}) are untouched; the other player in range is skipped as a teammate`, { special: s, inside, outside, pushed });
}

// ── pillar blocks every actor ───────────────────────────────────────────────────────────────────────────────────────
{
  const t = P0.north[0] + DEF.SPECIAL_KNOCKBACK.startup, before = actor(t - 1, D.pillar), after = actor(t + 25, D.pillar), h0 = actor(t - 1, 0);
  const layout = readJson(join(ROOT, 'games/nr/assets/arena/layout.json'));
  const p = layout.solids.find((x) => x.id === 'pillar'), half = 0.45, x0 = p.x - p.w / 2 - half;
  const dx = before.x - h0.x, dz = before.lane - h0.lane, d = Math.hypot(dx, dz), knock = 0.28 * (14 + 1) / 2, free = before.x + (dx / d) * knock;
  record('pillar', free > x0 + 0.3 && after.x <= x0 + 1e-3 && after.x > x0 - 0.05 && after.hp === 11, `a dummy pushed at the pillar (the push alone would take it from x ${before.x.toFixed(2)} to ${free.toFixed(2)}) stops at the pillar's rectangle, x ${after.x.toFixed(3)} (edge ${x0.toFixed(3)}), with no input of its own`, { before, after, free, edge: x0 });
}

// ── dash special ────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const s = P0.north[1], d = DEF.SPECIAL_DASH, from = actor(s + d.startup - 1, 0), to = actor(s + d.startup + d.active - 1, 0);
  const n = 15, speed = num('SPECIAL_DASH_SPEED'), want = n * speed;
  const onPath = [D.path, D.stand].map((id) => ({ id, hit: hits(0, id).filter((e) => e.tick > s && e.tick < s + d.total) }));
  const swept = onPath.every(({ id, hit }) => hit.length === 1 && (() => { const h = actor(hit[0].tick, 0), v = actor(hit[0].tick, id); return h.x - 0.3 < v.x + 0.35 && h.x + 1.0 > v.x - 0.35; })());
  const order = onPath[0].hit[0]?.tick < onPath[1].hit[0]?.tick;
  record('dash special', near(to.x - from.x, want, 2e-3) && from.lane === to.lane && swept && order && ev('SKIP_TEAM', 0, (e) => e.tick > s && e.tick < s + d.total).every((e) => e.a === 1),
    `special+l at ${s}: the hero moves ${(to.x - from.x).toFixed(3)} units (${n} ticks at ${speed}) from x ${from.x.toFixed(2)}; each of the 2 dummies on the path is hit once (ticks ${onPath.map((p) => p.hit[0]?.tick)}), as the swept box reaches it, in path order`, { special: s, from, to, onPath });
}

// ── friendly fire ───────────────────────────────────────────────────────────────────────────────────────────────────
{
  const a = P0.west[P0.west.length - 1], t = a + DEF.HIT1.startup, p0 = actor(t, 0), p1 = actor(t, 1), before = actor(a - 1, 1), after = actor(t + 30, 1);
  const inReach = (p1.x - p0.x) * p0.facing > 0.2 - 0.35 && (p1.x - p0.x) * p0.facing < 1.3 + 0.35 && Math.abs(p1.lane - p0.lane) <= 0.6;
  const skip = ev('SKIP_TEAM', 0, (e) => e.a === 1 && e.tick === t).length === 1, noHit = !ev('HIT', 0, (e) => e.a === 1).length;
  const calm = !events.some((e) => e.actor === 1 && e.tick >= a && e.kind === 'ENTER' && ['hurt', 'knockdown'].includes(e.a));
  const enemy = hits(0, D.stand).some((e) => e.tick === t);
  record('friendly fire', inReach && skip && noHit && calm && after.hp === before.hp && enemy, `hit1 at ${a} with player 1 ${Math.abs(p1.x - p0.x).toFixed(2)} units away in the swing's reach and ${Math.abs(p1.lane - p0.lane).toFixed(2)} lanes apart: the overlap is logged as a teammate skip at ${t}, player 1 keeps hp ${after.hp} and never leaves idle, and the same swing hits the enemy dummy`, { swing: a, p0, p1 });
}

// ── hero hurt, invulnerability, knockdown, getup ────────────────────────────────────────────────────────────────────
{
  const main = readFileSync(join(ROOT, 'games/nr/main.c'), 'utf8'), strikes = [...main.matchAll(/\{ (\d+), NR_ST_(HIT\d) \}/g)].map((m) => [+m[1], m[2]]);
  const [s1, s2, s3] = strikes.map((x) => x[0]), hit1 = s1 + DEF.HIT1.startup, skip = s2 + DEF.HIT1.startup, hit3 = s3 + DEF.HIT3.startup;
  const first = ev('HIT', D.striker, (e) => e.a === 1 && e.tick === hit1 && e.b === 1).length === 1, hurt = enters(1, 'hurt').some((e) => e.tick === hit1);
  const inv = actor(hit1 + 1, 1), invEnd = actor(hit1 + 60, 1);
  const skipped = ev('SKIP_INVULN', D.striker, (e) => e.a === 1 && e.tick === skip).length === 1 && !ev('HIT', D.striker, (e) => e.tick === skip).length;
  const second = ev('HIT', D.striker, (e) => e.a === 1 && e.tick === hit3 && e.b === 2).length === 1, kd = enters(1, 'knockdown').find((e) => e.tick === hit3);
  const getup = enters(1, 'getup').find((e) => e.tick === hit3 + DEF.KNOCKDOWN.total), idle = enters(1, 'idle').find((e) => e.tick === hit3 + DEF.KNOCKDOWN.total + DEF.GETUP.total);
  const down = actor(hit3 + 20, 1), end = actor(hit3 + DEF.KNOCKDOWN.total + DEF.GETUP.total + 1, 1);
  record('hero hurt', first && hurt && inv.hp === 11 && inv.invuln === 59 && invEnd.invuln === 0 && skipped && second && !!kd && !!getup && !!idle && down.state === 'knockdown' && end.state === 'idle' && end.hp === 9,
    `a swing at ${hit1} hurts player 1 (hp 11, invulnerable 60 ticks); the swing at ${skip} is skipped (invulnerable); the knockdown swing at ${hit3} hits for 2 (hp ${end.hp}), the hero is down ${DEF.KNOCKDOWN.total} ticks, gets up for ${DEF.GETUP.total} and is idle at ${idle?.tick}`, { hit1, skip, hit3 });
}

// ── movement ────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const walkSpeed = num('WALK_SPEED'), runSpeed = num('RUN_SPEED'), w0 = P0.right[0], w1 = script.find((e) => e.frame > w0 && !e.buttons.includes('right')).frame;
  const x28 = actor(w1, 0).x, ticksWalked = w1 - w0;
  const walkOk = enters(0, 'walk').some((e) => e.tick === w0) && near(x28, ticksWalked * walkSpeed, 2e-3);
  const run = enters(1, 'run').find((e) => e.tick >= P1.right[0]);
  const a = actor(run.tick + 5, 1), b = actor(run.tick + 15, 1), runOk = near((b.x - a.x) / 10, runSpeed, 1e-3);
  const dash = P0.r[0], dashFrom = actor(dash + 2, 0), dashTo = actor(dash + 20, 0), dashEnter = enters(0, 'dash').some((e) => e.tick === dash), dashEnd = enters(0, 'idle').some((e) => e.tick === dash + DEF.DASH.total);
  const dashOk = dashEnter && dashEnd && near(dashTo.x - dashFrom.x, 13 * num('DASH_SPEED'), 2e-3);
  const jump = P0.south[1], jumpEnter = enters(0, 'jump').find((e) => e.tick === jump), land = ev('ENTER', 0, (e) => e.a === 'idle' && e.tick > jump)[0], peak = actor(jump + 18, 0);
  const clipTicks = (n) => { const c = hero.clips.find((x) => x.name === n); return Math.round((c.count * c.ms * 60) / 1000); };
  const jumpOk = !!jumpEnter && land.tick - jump === clipTicks('jump') && peak.y > 1.0 && peak.y < 1.4;
  const left = P0.left[0], face = actor(left + 8, 0), end = actor(FULL, 0), faceOk = face.facing === -1 && end.facing === -1 && actor(left - 1, 0).facing === 1 && end.x < actor(left - 1, 0).x;
  const sp = P0.north[0] + DEF.SPECIAL_KNOCKBACK.startup, hero0 = actor(sp - 1, 0);
  const turned = actor(sp - 1, D.ungrab).facing === -1 && actor(sp - 1, D.ungrab).x < hero0.x && actor(sp + 1, D.ungrab).facing === 1 && actor(sp + 1, D.near).facing === -1 && actor(60, D.striker).facing === 1;
  record('movement', walkOk && runOk && dashOk && jumpOk && faceOk && turned,
    `walk ${ticksWalked} ticks -> x ${x28.toFixed(3)} (${walkSpeed}/tick); the double tap makes player 1 run at ${((b.x - a.x) / 10).toFixed(3)}/tick; dash ${(dashTo.x - dashFrom.x).toFixed(2)} units over its ${DEF.DASH.total} ticks; a plain jump lasts ${land.tick - jump} ticks (the jump clip's ${clipTicks('jump')}), peak ${peak.y.toFixed(2)}; walking left turns the hero (facing ${face.facing}); a hit victim turns to face its attacker (the dummy left of the special's hero turns right, the one right of it keeps facing left)`,
    { walkSpeed, runSpeed, x28, jumpTicks: land.tick - jump });
}

// ── state table against the clips ───────────────────────────────────────────────────────────────────────────────────
{
  const rows = [];
  let ok = true;
  for (const [id, def] of Object.entries(DEF)) {
    const clip = hero.clips.find((c) => c.name === def.name);
    if (!clip || def.total === 0) { rows.push({ state: def.name, total: def.total, startup: def.startup, active: def.active, clipTicks: clip ? Math.round((clip.count * clip.ms * 60) / 1000) : null }); continue; }
    const clipTicks = (clip.count * clip.ms * 60) / 1000, good = Math.abs(def.total - clipTicks) <= 1;
    ok = ok && good;
    rows.push({ state: def.name, total: def.total, startup: def.startup, active: def.active, recovery: def.total - def.startup - def.active, clipTicks: +clipTicks.toFixed(1), match: good });
  }
  record('state table', ok, `${rows.filter((r) => r.match !== undefined).length} timed states: every length is within a tick of its clip's frames x ms`, { rows });
  full.table = rows;
}

// ── determinism ─────────────────────────────────────────────────────────────────────────────────────────────────────
const nrFields = (st) => Object.fromEntries(Object.entries(st).filter(([k]) => /^(nr\.|cw\.three\.missing$)/.test(k) && k !== 'nr.px'));
const digest = (st) => createHash('sha256').update(JSON.stringify(nrFields(st))).digest('hex');
{
  const again = run(FULL, INPUT, 'again');
  const a = JSON.stringify(nrFields(full.st)), b = JSON.stringify(nrFields(again.st));
  const png = createHash('sha256').update(readFileSync(`${full.base}.png`)).digest('hex') === createHash('sha256').update(readFileSync(`${again.base}.png`)).digest('hex');
  record('determinism', a === b && png && full.st['nr.checksum'] === again.st['nr.checksum'], `the same script twice: ${Object.keys(nrFields(full.st)).length} whitelisted fields byte-identical (sha256 ${digest(full.st).slice(0, 16)}), checksum ${full.st['nr.checksum']} both times, the screenshot byte-identical`,
    { checksum: full.st['nr.checksum'], whitelistSha256: digest(full.st), screenshotEqual: png });
  writeFileSync(join(OUT, 'determinism.json'), `${JSON.stringify({ ticks: FULL, checksum: [full.st['nr.checksum'], again.st['nr.checksum']], simChecksum: [full.st['nr.sim_checksum'], again.st['nr.sim_checksum']], whitelistSha256: [digest(full.st), digest(again.st)], fields: Object.keys(nrFields(full.st)).length, screenshotEqual: png }, null, 2)}\n`);
}

// ── input shift ─────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const shifted = join(OUT, 'input-combat-shift1.json');
  writeFileSync(shifted, spawnSync('node', ['games/nr/tests/gen-input-combat.mjs', '--shift', '1'], { cwd: ROOT, encoding: 'utf8' }).stdout);
  const sh = (t) => run(t, resolve(shifted), 'shift').st;
  const differs = sh(FULL)['nr.checksum'] !== full.st['nr.checksum'];
  // the first tick the checksum differs, by bisection
  let lo = 1, hi = FULL;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sh(mid)['nr.checksum'] !== at(mid)['nr.checksum']) hi = mid; else lo = mid + 1; }
  const first = lo, a = nrFields(at(first)), b = nrFields(sh(first));
  const fields = Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  const noLaterAgreement = [first, first + 1, 100, 300, FULL].every((t) => t >= first && sh(t)['nr.checksum'] !== at(t)['nr.checksum']);
  record('input shift', differs && first > 0 && fields.length > 0 && noLaterAgreement, `the script one tick late: the checksum differs at tick ${first} (${at(first)['nr.checksum']} against ${sh(first)['nr.checksum']}) and at the end (${full.st['nr.checksum']} against ${sh(FULL)['nr.checksum']}); first field to differ in the dump order: ${fields[0]}; ${fields.length} fields differ at that tick`,
    { firstDivergentTick: first, firstField: fields[0], fields });
  writeFileSync(join(OUT, 'shift-control.json'), `${JSON.stringify({ shift: 1, firstDivergentTick: first, firstField: fields[0], differingFields: fields, checksumAtFirst: [at(first)['nr.checksum'], sh(first)['nr.checksum']], checksumAtEnd: [full.st['nr.checksum'], sh(FULL)['nr.checksum']] }, null, 2)}\n`);
}

// ── whitelist ───────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const N = 9, sizes = { 'nr.hero_pos': N * 3, 'nr.actor_y': N, 'nr.actor_vy': N, 'nr.actor_state': N, 'nr.actor_state_tick': N, 'nr.actor_hp': N, 'nr.actor_facing': N, 'nr.actor_team': N, 'nr.actor_invuln': N,
    'nr.hero_clip': N, 'nr.hero_step': N, 'nr.hero_frame': N, 'nr.rng': 4, 'nr.events': 512 * 5, 'nr.light_pos': 12, 'nr.light_intensity': 4 };
  const scalars = ['nr.wave', 'nr.lives', 'nr.cam_x', 'nr.cam_left', 'nr.ticks', 'nr.input_count', 'nr.checksum', 'nr.sim_checksum', 'nr.event_count', 'nr.events_dropped'];
  const st = full.st, missing = [...Object.keys(sizes), ...scalars].filter((k) => !(k in st)), badSize = Object.entries(sizes).filter(([k, n]) => st[k]?.length !== n);
  const rngStart = at(1)['nr.rng'].join(), rngEnd = st['nr.rng'].join();
  const ok = !missing.length && !badSize.length && st['nr.wave'] === 0 && st['nr.lives'] === 3 && st['nr.events_dropped'] === 0 && st['cw.three.missing'] === 0 && st['nr.ticks'] === FULL && rngStart === rngEnd && st['nr.input_count'] > 0 && st['nr.event_count'] > 50;
  record('whitelist', ok, `${Object.keys(sizes).length + scalars.length} fields with the expected sizes (${N} actors); wave ${st['nr.wave']}, lives ${st['nr.lives']}, rng ${rngEnd} (no consumer yet), input count ${st['nr.input_count']} of ${FULL} ticks, ${st['nr.event_count']} events (${st['nr.events_dropped']} dropped), cw.three.missing ${st['cw.three.missing']}`, { missing, badSize });
  full.fields = [...Object.keys(sizes), ...scalars];
}

// ── report ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const lines = events.map((e) => `${String(e.tick).padStart(4)} ${e.kind.padEnd(11)} a${e.actor} ${e.kind === 'ENTER' ? e.a : `${e.a} ${e.b}`}`);
writeFileSync(join(OUT, 'events.txt'), `${lines.join('\n')}\n`);
writeFileSync(join(OUT, 'state-table.json'), `${JSON.stringify(full.table, null, 2)}\n`);
writeFileSync(join(OUT, 'sim-report.json'), `${JSON.stringify({ script: INPUT, ticks: FULL, presses, results }, null, 2)}\n`);
writeFileSync(join(OUT, 'final-state.json'), `${JSON.stringify(nrFields(full.st))}\n`);
console.log(failed ? `${failed} scenario(s) failed` : `all ${results.length} scenarios passed (${events.length} events, whitelist sha256 ${digest(full.st).slice(0, 16)})`);
if (PUBLISH) {
  mkdirSync(PUBLISH, { recursive: true });
  for (const f of ['events.txt', 'state-table.json', 'sim-report.json', 'determinism.json', 'shift-control.json', 'final-state.json']) copyFileSync(join(OUT, f), join(PUBLISH, f));
}
process.exit(failed ? 1 : 0);
