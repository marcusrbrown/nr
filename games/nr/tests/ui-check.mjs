// Checks of the Unit 7 flow on the native binary (WebGPU): title, join, the upgrade pause, the end screens, sound and the
// HUD's glyph baking.
//
//   CW_TEST_GPU=desktop node games/nr/tests/ui-check.mjs [--out out/unit7/ui] [--publish docs/evidence/combat-slice/unit7]
//
// Method. The app publishes the phase, the pick, the joins, the sounds the simulation asked for and an event log of every
// state entry, join, pick and phase change (nr.*). Each scenario runs a script from games/nr/tests (written by
// gen-input-unit7.mjs; the menu presses sit at fixed ticks after the pause began) and reads the log and the state at chosen
// ticks. Expectations come from the source's own constants (sim.h, sim.c, main.c), not from numbers typed here. Every
// scenario records ok or FAIL with its detail and artifact (ui-report.json holds the data).
//
//   title               nobody is present until start; players at the title put 3 lives each into the pool; the tick-30
//                       presence rule does not apply; the fight begins on a second start from a player that is in
//   AE2 upgrade         a pick in the lockout and a start from a player that is in change nothing; player 2's pick of the
//                       dash is the special of both heroes, to the end of the arena; the knockback never returns
//   pause               nothing but the tick counter moves while the pause is up
//   same frame          both players pick on one frame: the lower port's pick applies
//   joiner in pause     pad 2 starts during the pause: it joins (+3 lives), the pause stays up, player 1's pick is its special,
//                       and the pause does not come again
//   AE3 mid-fight join  pad 2 starts mid-fight: it stands at the left edge of the camera's frame with +3 lives and the next spawns split
//   no duplicate        start on a joined pad, in the fight, joins nobody
//   full run            title -> four waves -> clear: one run's whole whitelist and screenshot twice byte-identical, the same
//                       as the bot's own run
//   clear -> title      back at the clear screen returns to the title
//   game over           start is refused (counted), back returns to the title; the tick counter goes on
//   glyphs              no glyph is baked after frame 0 on any screen (a profiler trace of each); the control sees the bakes of frame 0
//   sound               every sound is asked for, counted with its tick, played with a voice, within its voice cap
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { nativeWgpu } from './capture-lib.mjs';
import { ROOT } from './look-lib.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const OUT = resolve(ROOT, opt('out', 'out/unit7/ui'));
const PUBLISH = opt('publish') ? resolve(ROOT, opt('publish')) : null;
mkdirSync(join(OUT, 'input'), { recursive: true });
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const results = [];
let failed = 0;
const lines = [];
function record(name, ok, detail, data = {}) {
  results.push({ name, ok, detail, ...data });
  if (!ok) failed++;
  const line = `${ok ? 'ok  ' : 'FAIL'} ${name}: ${detail}${data.artifact ? ` [${data.artifact}]` : ''}`;
  lines.push(line);
  console.log(line);
}
const near = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;

// ── what the check reads from the source ────────────────────────────────────────────────────────────────────────────
const T = 'games/nr/tests/';
const src = (f) => readFileSync(join(ROOT, 'games/nr', f), 'utf8');
const simH = src('sim.h'), simC = src('sim.c'), mainC = src('main.c');
const enumNames = (s, type, prefix, first = 0) => [...s.match(new RegExp(`typedef enum \\{([\\s\\S]*?)\\} ${type};`))[1].matchAll(new RegExp(`${prefix}([A-Z_0-9]+)`, 'g'))].map((m, i) => [m[1], first + i]);
const ST = Object.fromEntries(enumNames(simH, 'nr_state', 'NR_ST_').filter(([n]) => n !== 'COUNT'));
const EV = Object.fromEntries(enumNames(simH, 'nr_event_kind', 'NR_EV_', 1));
const PH = Object.fromEntries(enumNames(simH, 'nr_phase', 'NR_PH_').filter(([n]) => n !== 'COUNT'));
const SFX = Object.fromEntries(enumNames(simH, 'nr_sfx', 'NR_SFX_').filter(([n]) => n !== 'COUNT'));
const define = (s, name) => +s.match(new RegExp(`#define ${name} ([0-9.]+)`))[1];
const LIVES = define(simH, 'NR_LIVES_PER_PLAYER'), LOCKOUT = define(simH, 'NR_UPGRADE_LOCKOUT'), PRESENCE = define(simH, 'NR_PRESENCE_TICKS');
const MARGIN = define(simC, 'RESPAWN_MARGIN'), PPU = define(mainC, 'PPU'), DESIGN_W = define(mainC, 'DESIGN_W'), DESIGN_H = define(mainC, 'DESIGN_H'), SCALE = define(mainC, 'PIXEL_SCALE');
const FOV = define(mainC, 'FOV_DEG'), PITCH = define(mainC, 'PITCH_DEG'), ACTOR_HALF = define(mainC, 'ACTOR_HALF');
const voiceCaps = Object.fromEntries([...mainC.matchAll(/\[NR_SFX_([A-Z]+)\] = \{ "audio\/(\w+)\.wav", (\d+) \}/g)].map((m) => [m[1], { file: `${m[2]}.wav`, maxVoices: +m[3] }]));

/** the half width of the frame at `lane`, less the actor's, as nr_sim_view_half computes it from main.c's camera constants */
function viewHalf(lane) {
  const tanHalf = Math.tan((FOV * 0.5 * Math.PI) / 180), dist = (DESIGN_H / SCALE / PPU) / (2 * tanHalf), cosP = Math.cos((PITCH * Math.PI) / 180);
  return (DESIGN_W / SCALE / PPU) * 0.5 * (dist - lane * cosP) / dist - ACTOR_HALF;
}

// ── runs ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const cache = new Map();
function run(ticks, input, tag, app = 'nr', env = {}) {
  const key = `${tag}-${ticks}`;
  if (cache.has(key)) return cache.get(key);
  const base = join(OUT, `${tag}-t${ticks}`);
  const r = nativeWgpu(app, base, ticks, { input, inputDir: join(OUT, 'input'), env });
  if (r.status !== 0) throw new Error(`${app} to tick ${ticks}: ${(r.stderr || r.stdout || '').slice(-300)}`);
  const out = { base, st: readJson(`${base}.json`) };
  cache.set(key, out);
  return out;
}
const decode = (st) => {
  const e = st['nr.events'], kinds = Object.fromEntries(Object.entries(EV).map(([n, v]) => [v, n])), states = Object.fromEntries(Object.entries(ST).map(([n, v]) => [v, n]));
  return Array.from({ length: st['nr.event_count'] }, (_, i) => {
    const [tick, k, actor, a, b] = e.slice(i * 5, i * 5 + 5);
    return { tick, kind: kinds[k], actor, a: kinds[k] === 'ENTER' ? states[a] : a, b };
  });
};
const ofKind = (events, kind, pred = () => true) => events.filter((e) => e.kind === kind && pred(e));
const scriptOf = (name) => readJson(join(ROOT, T, name));
const digest = (st) => createHash('sha256').update(JSON.stringify(Object.keys(st).filter((k) => k.startsWith('nr.')).sort().map((k) => [k, st[k]]))).digest('hex');
const pos = (st, i) => [st['nr.hero_pos'][i * 3], st['nr.hero_pos'][i * 3 + 1]];

/** the tick the pause began, and a script's tick for a menu press relative to it, from the run's own log */
const pauseTick = (events) => ofKind(events, 'PHASE', (e) => e.a === PH.UPGRADE)[0]?.tick;

// ── title ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const FULL_N = 2300;
const full = run(FULL_N, `${T}input-2p-full.json`, 'full');
const fev = decode(full.st);
{
  const joins = ofKind(fev, 'JOIN'), begin = ofKind(fev, 'BEGIN')[0];
  const s30 = run(30, `${T}input-2p-full.json`, 'full').st, s50 = run(50, `${T}input-2p-full.json`, 'full').st, idle = run(120, `${T}input-idle.json`, 'idle').st;
  const ok = joins.length === 2 && joins[0].actor === 0 && joins[0].a === LIVES && joins[1].actor === 1 && joins[1].a === 2 * LIVES && joins.every((j) => j.b === PH.TITLE) &&
    begin?.a === 2 && begin?.b === 2 * LIVES && begin.tick > joins[1].tick &&
    s30['nr.phase'] === PH.TITLE && s30['nr.players'] === 1 && s30['nr.lives'] === LIVES && s50['nr.phase'] === PH.TITLE && s50['nr.players'] === 2 && s50['nr.lives'] === 2 * LIVES &&
    idle['nr.phase'] === PH.TITLE && idle['nr.players'] === 0 && idle['nr.lives'] === 0 && idle['nr.actor_present'].slice(0, 2).join() === '0,0';
  record('title', ok, `with nobody pressing start the title holds at tick 120 (phase ${idle['nr.phase']}, players ${idle['nr.players']}, lives ${idle['nr.lives']}; both pads are connected, so the tick-${PRESENCE} presence rule is not applied); start from pad 1 at tick ${joins[0]?.tick} joins player 1 (pool ${joins[0]?.a}), from pad 2 at ${joins[1]?.tick} joins player 2 (pool ${joins[1]?.a}); a start from a player that is in begins the fight at ${begin?.tick} with ${begin?.a} players and ${begin?.b} lives`,
    { joins, begin, artifact: 'ui-report.json' });
}

// ── AE2 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
let TP;
{
  const probe = run(FULL_N, `${T}input-2p-full.json`, 'full');
  TP = pauseTick(decode(probe.st));
  const up = run(TP + 260, `${T}input-upgrade.json`, 'upgrade'), ev = decode(up.st);
  const picks = ofKind(ev, 'PICK'), ign = ofKind(ev, 'START_IGNORED'), knock = ev.filter((e) => e.kind === 'ENTER' && e.a === 'SPECIAL_KNOCKBACK' && e.tick > TP), dash = ev.filter((e) => e.kind === 'ENTER' && e.a === 'SPECIAL_DASH' && e.tick > TP);
  const fulls = fev, pick = ofKind(fulls, 'PICK')[0];
  const knockAfter = fulls.filter((e) => e.kind === 'ENTER' && e.a === 'SPECIAL_KNOCKBACK' && e.tick > pick.tick), dashAfter = fulls.filter((e) => e.kind === 'ENTER' && e.a === 'SPECIAL_DASH' && e.tick > pick.tick);
  const ok = TP > 0 && picks.length === 1 && picks[0].actor === 1 && picks[0].a === 1 && picks[0].b === 40 && ign.length === 1 && ign[0].actor === 1 && ign[0].tick === TP + 5 &&
    dash.map((e) => `${e.actor}@${e.tick}`).join() === `0@${TP + 100},1@${TP + 140}` && !knock.length && up.st['nr.special_variant'] === 1 && up.st['nr.pick_player'] === 1 && up.st['nr.phase'] === PH.FIGHT &&
    knockAfter.length === 0 && dashAfter.length > 0 && pick.actor === 1 && pick.a === 1;
  record('AE2 upgrade', ok, `the pause begins at tick ${TP} (wave 2's last kill); a pick at +10 is inside the ${LOCKOUT}-tick lockout and does nothing; start from player 2 (in) at +5 is ignored (${ign.length} logged); player 2 picks the dash at +40; the heroes' next specials, at +100 (player 1) and +140 (player 2), are both special_dash (${dash.length} dash, ${knock.length} knockback); in the full run ${dashAfter.length} dash specials and ${knockAfter.length} knockback specials follow the pick to the end of the arena`,
    { pauseTick: TP, picks, ignored: ign, dash, knockbackAfterPick: knockAfter.length, artifact: 'upgrade-events.json' });
  writeFileSync(join(OUT, 'upgrade-events.json'), `${JSON.stringify({ pauseTick: TP, events: ev.filter((e) => e.tick >= TP), fullRunDashAfterPick: dashAfter.length, fullRunKnockbackAfterPick: knockAfter.length }, null, 2)}\n`);

  // nothing advances in the pause
  const a = run(TP + 6, `${T}input-upgrade.json`, 'upgrade').st, b = run(TP + 29, `${T}input-upgrade.json`, 'upgrade').st;
  const same = ['nr.hero_pos', 'nr.actor_hp', 'nr.actor_state', 'nr.actor_state_tick', 'nr.rng', 'nr.cam_x', 'nr.wave_phase', 'nr.lives'].every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));
  record('pause', same && a['nr.phase'] === PH.UPGRADE && b['nr.phase'] === PH.UPGRADE && b['nr.ticks'] - a['nr.ticks'] === 23,
    `between ticks ${a['nr.ticks']} and ${b['nr.ticks']} of the pause (phase ${b['nr.phase']}) every position, hp, state, state tick, the rng, the camera, the wave phase and the lives are unchanged; only the tick counter moved`, { artifact: 'upgrade-events.json' });
}

// ── same frame ──────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const up = run(TP + 260, `${T}input-upgrade-tie.json`, 'tie'), ev = decode(up.st);
  const picks = ofKind(ev, 'PICK'), sp = ev.filter((e) => e.kind === 'ENTER' && (e.a === 'SPECIAL_KNOCKBACK' || e.a === 'SPECIAL_DASH') && e.tick > TP);
  const ok = picks.length === 1 && picks[0].actor === 0 && picks[0].a === 0 && up.st['nr.pick_player'] === 0 && up.st['nr.special_variant'] === 0 && sp.length === 2 && sp.every((e) => e.a === 'SPECIAL_KNOCKBACK');
  record('same frame', ok, `player 1 presses left and player 2 right on tick ${TP + 40}: one pick, by player ${picks[0]?.actor + 1} (the lower port), special ${picks[0]?.a} (knockback); player 2's special at +140 is ${sp[1]?.a}`, { picks, specials: sp, artifact: 'ui-report.json' });
}

// ── joiner in the pause ─────────────────────────────────────────────────────────────────────────────────────────────
{
  const sole = run(1500, `${T}input-upgrade-join.json`, 'solo-probe', 'nr_botsolo');
  const TS = pauseTick(decode(sole.st));
  const up = run(TS + 220, `${T}input-upgrade-join.json`, 'upjoin'), ev = decode(up.st);
  const mid = run(TS + 30, `${T}input-upgrade-join.json`, 'upjoin').st;
  const joins = ofKind(ev, 'JOIN'), picks = ofKind(ev, 'PICK'), pauses = ofKind(ev, 'PHASE', (e) => e.a === PH.UPGRADE), dash = ev.filter((e) => e.kind === 'ENTER' && e.a === 'SPECIAL_DASH' && e.tick > TS);
  const ok = TS > 0 && joins.filter((j) => j.tick > TS).length === 1 && joins.at(-1).actor === 1 && joins.at(-1).tick === TS + 20 && joins.at(-1).b === PH.UPGRADE && joins.at(-1).a === 2 * LIVES &&
    mid['nr.phase'] === PH.UPGRADE && mid['nr.players'] === 2 && picks.length === 1 && picks[0].actor === 0 && picks[0].a === 1 && picks[0].b === 60 && pauses.length === 1 &&
    dash.length === 1 && dash[0].actor === 1 && up.st['nr.phase'] === PH.FIGHT && up.st['nr.special_variant'] === 1;
  record('joiner in pause', ok, `player 1 alone reaches the pause at tick ${TS}; pad 2 starts at +20 and joins (pool ${joins.at(-1)?.a}, players ${mid['nr.players']}) while the pause stays up (phase ${mid['nr.phase']} at +30); player 1 picks the dash at +60 (${picks.length} pick); the joiner's special at +100 is ${dash[0]?.a}; the pause entered ${pauses.length} time(s), so the joiner got no second prompt`,
    { pauseTick: TS, joins, picks, artifact: 'ui-report.json' });
}

// ── AE3 and no duplicate ────────────────────────────────────────────────────────────────────────────────────────────
{
  const J = 200;
  const m = run(800, `${T}input-join-mid.json`, 'mid'), ev = decode(m.st);
  const before = run(J - 1, `${T}input-join-mid.json`, 'mid').st, at = run(J, `${T}input-join-mid.json`, 'mid').st;
  const joins = ofKind(ev, 'JOIN', (e) => e.actor === 1), spawns = ofKind(ev, 'SPAWN', (e) => e.tick > J), after = spawns.map((e) => e.b);
  const n0 = after.filter((t) => t === 0).length, n1 = after.filter((t) => t === 1).length;
  const [x, lane] = pos(at, 1), want = at['nr.cam_x'] - viewHalf(lane) + MARGIN;
  const alternates = after.every((t, i) => i === 0 || t !== after[i - 1] || spawns[i].tick - spawns[i - 1].tick > 0) && Math.abs(n0 - n1) <= 1 && n0 + n1 === after.length;
  const ok = joins.length === 1 && joins[0].tick === J && joins[0].a === before['nr.lives'] + LIVES && joins[0].b === PH.FIGHT && before['nr.players'] === 1 && at['nr.players'] === 2 &&
    before['nr.actor_present'][1] === 0 && at['nr.actor_present'][1] === 1 && near(x, want, 0.02) && x < at['nr.cam_x'] - 3 && spawns.length >= 4 && alternates && n0 > 0 && n1 > 0;
  record('AE3 mid-fight join', ok, `solo, ${before['nr.lives']} lives; pad 2 starts at tick ${J}: player 2 stands at x ${x.toFixed(3)} (left edge of the frame: camera ${at['nr.cam_x'].toFixed(3)} - half-width ${viewHalf(lane).toFixed(3)} + ${MARGIN} = ${want.toFixed(3)}), the pool goes ${before['nr.lives']} -> ${at['nr.lives']} (+${LIVES}), players 1 -> 2; the ${spawns.length} spawns after it target ${after.join(',')} (${n0} to player 1, ${n1} to player 2)`,
    { joins, spawnTargets: after, x, want, artifact: 'join-events.json' });
  const igns = ofKind(ev, 'START_IGNORED'), joinAll = ofKind(ev, 'JOIN');
  const okDup = joinAll.length === 2 && igns.length === 2 && igns[0].actor === 1 && igns[0].tick === J + 60 && igns[1].actor === 0 && igns[1].tick === J + 80 && m.st['nr.joins'] === 1 && m.st['nr.ignored_starts'] === 2 && m.st['nr.players'] === 2;
  record('no duplicate', okDup, `start from pad 2 again at tick ${J + 60} and from pad 1 at ${J + 80} (both in) join nobody: ${joinAll.length} joins in all (player 1 at the title, player 2 once), ${igns.length} starts logged as ignored (actors ${igns.map((e) => e.actor)}), players ${m.st['nr.players']}, mid-run joins ${m.st['nr.joins']}`,
    { ignored: igns, artifact: 'join-events.json' });
  writeFileSync(join(OUT, 'join-events.json'), `${JSON.stringify({ joinTick: J, events: ev.filter((e) => ['JOIN', 'START_IGNORED', 'SPAWN', 'RESPAWN', 'PHASE'].includes(e.kind)) }, null, 2)}\n`);
}

// ── full run ────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const again = run(FULL_N, `${T}input-2p-full.json`, 'full-again');
  const bot = run(FULL_N, `${T}input-idle.json`, 'bot', 'nr_botfull');
  const a = readFileSync(`${full.base}.png`), b = readFileSync(`${again.base}.png`);
  const ok = full.st['nr.checksum'] === again.st['nr.checksum'] && digest(full.st) === digest(again.st) && a.equals(b) && full.st['nr.checksum'] === bot.st['nr.checksum'] && full.st['nr.sim_checksum'] === bot.st['nr.sim_checksum'] &&
    full.st['nr.phase'] === PH.CLEAR && full.st['nr.cleared'] === 1 && full.st['nr.events_dropped'] === 0 && full.st['cw.three.missing'] === 0;
  record('full run', ok, `${scriptOf('input-2p-full.json').length} script entries, ${FULL_N} ticks, title to the clear screen (phase ${full.st['nr.phase']}) twice: ${Object.keys(full.st).filter((k) => k.startsWith('nr.')).length} nr.* fields byte-identical (sha256 ${digest(full.st).slice(0, 16)}), checksum ${full.st['nr.checksum']} both times and the screenshot identical; the bot's own run ends on ${bot.st['nr.checksum']}, the same; ${full.st['nr.event_count']} events, ${full.st['nr.events_dropped']} dropped, cw.three.missing ${full.st['cw.three.missing']}`,
    { checksum: [full.st['nr.checksum'], again.st['nr.checksum'], bot.st['nr.checksum']], whitelistSha256: digest(full.st), artifact: 'full-determinism.json' });
  writeFileSync(join(OUT, 'full-determinism.json'), `${JSON.stringify({ ticks: FULL_N, checksum: [full.st['nr.checksum'], again.st['nr.checksum']], botChecksum: bot.st['nr.checksum'], simChecksum: [full.st['nr.sim_checksum'], again.st['nr.sim_checksum']], whitelistSha256: [digest(full.st), digest(again.st)], screenshotEqual: a.equals(b) }, null, 2)}\n`);
}

// ── clear -> title, game over ───────────────────────────────────────────────────────────────────────────────────────
{
  const rows = scriptOf('input-2p-full.json').filter((r) => r.frame <= FULL_N);
  const withBack = [...rows, { frame: 2400, buttons: ['start'], pad2: { buttons: [] } }, { frame: 2402, buttons: ['back'], pad2: { buttons: [] } }, { frame: 2404, buttons: [], pad2: { buttons: [] } }];
  const f1 = join(OUT, 'input-clear-back.json');
  writeFileSync(f1, `${JSON.stringify(withBack)}\n`);
  const before = run(2401, f1, 'clearback').st, after = run(2450, f1, 'clearback').st;
  const ok = before['nr.phase'] === PH.CLEAR && before['nr.start_refused'] === 0 && after['nr.phase'] === PH.TITLE && after['nr.players'] === 0 && after['nr.lives'] === 0 && after['nr.wave'] === 0 && after['nr.ticks'] === 2450 && after['nr.cleared'] === 0;
  record('clear -> title', ok, `the clear screen at tick 2401 (phase ${before['nr.phase']}) ignores start; back at 2402 returns to the title: phase ${after['nr.phase']}, players ${after['nr.players']}, lives ${after['nr.lives']}, wave ${after['nr.wave']}, cleared ${after['nr.cleared']}, the tick counter on at ${after['nr.ticks']}`, { artifact: 'ui-report.json' });

  // game over: player 1 alone, left to be beaten; start at the end is refused, back returns to the title, a start there joins again
  const idle = [{ frame: 1, buttons: [], pad2: { buttons: [] } }, { frame: 20, buttons: ['start'] }, { frame: 22, buttons: [] }, { frame: 60, buttons: ['start'] }, { frame: 62, buttons: [] }, { frame: 4300, buttons: ['start'] }, { frame: 4302, buttons: [] }, { frame: 4400, buttons: ['back'] }, { frame: 4402, buttons: [] }, { frame: 4500, buttons: ['start'] }, { frame: 4502, buttons: [] }];
  const f2 = join(OUT, 'input-gameover.json');
  writeFileSync(f2, `${JSON.stringify(idle)}\n`);
  const go = run(4350, f2, 'gameover'), gev = decode(go.st), over = ofKind(gev, 'GAME_OVER')[0];
  const frozen = run(4300, f2, 'gameover').st, ref = run(4350, f2, 'gameover').st, back = run(4450, f2, 'gameover').st, again = run(4520, f2, 'gameover').st;
  const same = ['nr.hero_pos', 'nr.actor_hp', 'nr.actor_state', 'nr.cam_x', 'nr.wave', 'nr.lives'].every((k) => JSON.stringify(frozen[k]) === JSON.stringify(ref[k]));
  const okGo = over && go.st['nr.phase'] === PH.GAMEOVER && go.st['nr.game_over'] === 1 && go.st['nr.start_refused'] === 1 && ofKind(gev, 'START_REFUSED').length === 1 && same &&
    back['nr.phase'] === PH.TITLE && back['nr.ticks'] === 4450 && back['nr.start_refused'] === 0 && again['nr.phase'] === PH.TITLE && again['nr.players'] === 1 && again['nr.lives'] === LIVES;
  record('game over', okGo, `solo and idle: the pool empties and the game is over at tick ${over?.tick}; the start at 4300 is refused (counted ${go.st['nr.start_refused']}, logged) and nothing moves; back at 4400 returns to the title (phase ${back['nr.phase']}, the tick counter on at ${back['nr.ticks']}); a start at 4500 joins a new player 1 (players ${again['nr.players']}, lives ${again['nr.lives']})`, { gameOverTick: over?.tick, artifact: 'ui-report.json' });
}

// ── glyphs ──────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const windows = [['frame 0 (control)', 0, 4], ['title and joins', 1, 80], ['fight', 400, 60], ['upgrade pause', TP + 1, 60], ['clear screen', 2200, 90]];
  const bakes = [];
  for (const [label, start, n] of windows) {
    const tag = `trace-${start}`, file = join(OUT, `${tag}.trace.json`);
    const r = nativeWgpu('nr', join(OUT, tag), start + n + 2, { input: `${T}input-2p-full.json`, inputDir: join(OUT, 'input'),
      env: { CW_PROFILE_TRACE: file, CW_PROFILE_TRACE_START: String(start), CW_PROFILE_TRACE_FRAMES: String(n) } });
    if (r.status !== 0) throw new Error(`trace ${label}: ${(r.stderr || r.stdout || '').slice(-200)}`);
    const tr = readJson(file), events = Array.isArray(tr) ? tr : tr.traceEvents;
    const frames = events.filter((e) => e.name === 'frame' && e.ph === 'X' && e.args && e.args.frame !== undefined);
    const baked = events.filter((e) => e.name === 'text.glyph_bake');
    const perFrame = {};
    for (const b of baked) { const f = frames.find((fr) => b.ts >= fr.ts && b.ts <= fr.ts + fr.dur); const k = f ? f.args.frame : 'outside'; perFrame[k] = (perFrame[k] || 0) + 1; }
    bakes.push({ label, start, frames: frames.length, bakeZones: baked.length, afterFrame0: Object.entries(perFrame).filter(([k]) => k !== '0').reduce((s, [, v]) => s + v, 0), perFrame });
  }
  const ctl = bakes[0], rest = bakes.slice(1);
  const st = full.st;
  const ok = ctl.bakeZones > 0 && (ctl.perFrame[0] || 0) > 0 && rest.every((w) => w.frames > 0 && w.afterFrame0 === 0 && w.bakeZones === 0) && st['nr.ui_glyphs_missing'] === 0 && st['r2d.atlas_pages'] === 1;
  record('glyphs', ok, `a profiler trace of each screen: the control sees ${ctl.perFrame[0] || 0} text.glyph_bake zones in frame 0 (the preload), and the title (${rest[0].frames} frames traced), the fight (${rest[1].frames}), the upgrade screen (${rest[2].frames}) and the clear screen (${rest[3].frames}) bake ${rest.map((w) => w.bakeZones).join(', ')} after it; glyphs missing ${st['nr.ui_glyphs_missing']}, render2d atlas pages ${st['r2d.atlas_pages']}`,
    { windows: bakes, artifact: 'glyph-bakes.json' });
  writeFileSync(join(OUT, 'glyph-bakes.json'), `${JSON.stringify({ windows: bakes, glyphsMissing: st['nr.ui_glyphs_missing'], atlasPages: st['r2d.atlas_pages'] }, null, 2)}\n`);
}

// ── sound ───────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const st = full.st, names = Object.keys(SFX), counts = st['nr.sfx_count'], ticks = st['nr.sfx_tick'], played = st['nr.sfx_played'];
  const capsOk = names.every((n) => voiceCaps[n]?.maxVoices > 0);
  const ok = counts.length === names.length && counts.every((c) => c > 0) && ticks.every((t) => t > 0 && t <= FULL_N) && played.every((p) => p > 0 && p <= FULL_N) && st['nr.voice_created'] === 1 && capsOk;
  record('sound', ok, `${names.map((n, i) => `${n.toLowerCase()} asked ${counts[i]}x, last at tick ${ticks[i]}, ${played[i]} voices`).join('; ')}; a voice was created (${st['nr.voice_created']}); per-sound voice caps ${names.map((n) => `${n.toLowerCase()} ${voiceCaps[n]?.maxVoices}`).join(', ')}`,
    { counts, ticks, played, voiceCaps, artifact: 'ui-report.json' });
}

writeFileSync(join(OUT, 'ui-report.json'), `${JSON.stringify({ results, constants: { LIVES, LOCKOUT, PRESENCE, MARGIN }, voiceCaps }, null, 2)}\n`);
writeFileSync(join(OUT, 'ui-report.txt'), `${lines.join('\n')}\n`);
if (PUBLISH) { mkdirSync(PUBLISH, { recursive: true }); for (const f of ['ui-report.json', 'ui-report.txt', 'upgrade-events.json', 'join-events.json', 'full-determinism.json', 'glyph-bakes.json']) copyFileSync(join(OUT, f), join(PUBLISH, f)); }
console.log(failed ? `${failed} scenario(s) FAILED` : `all ${results.length} scenarios passed`);
process.exit(failed ? 1 : 0);
