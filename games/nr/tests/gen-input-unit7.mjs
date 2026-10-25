// Writes the Unit 7 scripts next to this file:
//
//   input-2p-full.json         title -> four waves -> clear, both pads: the buttons the bot plays on `nr_botfull` (it joins,
//                              begins, fights, picks the dash with player 2 and presses back at the clear screen)
//   input-upgrade.json         AE2: two players reach the upgrade pause; a pick during the grace period and a start press from a
//                              player that is in change nothing; player 2 picks the dash; both specials are dash
//   input-upgrade-tie.json     the same pause with both players picking on one frame (left against right): the lower port wins
//   input-upgrade-join.json    player 1 alone reaches the pause; pad 2 joins during it, then player 1 picks: the joiner has the pick
//   input-join-mid.json        AE3: player 1 alone is fighting wave 1; pad 2 presses start (joins at the camera's edge), presses
//                              start again (nothing), and player 1 presses start (nothing)
//
//   node games/nr/tests/gen-input-unit7.mjs            write the files
//   node games/nr/tests/gen-input-unit7.mjs --check    exit 1 when a file differs from what the bots play now
//
// The fights up to the pause (or the whole of the join script) are the bots' own logs, so the scripts are what a pad would
// do; the menu presses after the pause are written here, relative to the tick the pause began (read from the bot's own
// run), so every script keeps the same relation to it if the fight changes.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { botRows, scriptText } from './gen-input-waves.mjs';

const DIR = dirname(fileURLToPath(import.meta.url));
const PH_UPGRADE = 2, EV_PHASE = 26;
process.env.CW_TEST_GPU ||= 'desktop';

/** the tick the simulation entered `phase`, from the event log of a bot run */
const phaseTick = (st, phase) => {
  const e = st['nr.events'];
  for (let i = 0; i < st['nr.event_count']; i++) if (e[i * 5 + 1] === EV_PHASE && e[i * 5 + 3] === phase) return e[i * 5];
  throw new Error(`no phase ${phase} in the run`);
};

/** rows (every row a full state) from bot rows cut at `cut` and hand events {frame, p0?, p1?}; pad 2 is connected from frame `p1From` */
function compose(botRows_, cut, hand, p1From) {
  const ev = [...botRows_.filter((r) => r.frame <= cut).map((r) => ({ frame: r.frame, p0: r.buttons, p1: r.pad2?.buttons ?? [] })), ...hand].sort((a, b) => a.frame - b.frame);
  const out = [];
  let p0 = [], p1 = [];
  for (const e of ev) {
    p0 = e.p0 ?? p0;
    p1 = e.p1 ?? p1;
    const row = { frame: e.frame, buttons: p0, ...(e.frame >= p1From ? { pad2: { buttons: p1 } } : {}) };
    if (out.length && out[out.length - 1].frame === e.frame) out[out.length - 1] = row; else out.push(row);
  }
  return out;
}

export function generate() {
  const files = {};
  const full = botRows('nr_botfull', 2300);
  files['input-2p-full.json'] = scriptText(full.rows);
  const T = phaseTick(full.st, PH_UPGRADE);
  const press = (frame, who, ...buttons) => [{ frame, [who]: buttons }, { frame: frame + 2, [who]: [] }];
  // AE2: a pick in the grace period (T+10) and start from a player that is in (T+5) do nothing; player 2 picks the dash at T+40;
  // each hero then uses its special (T+100, T+140)
  files['input-upgrade.json'] = scriptText(compose(full.rows, T, [
    { frame: T + 1, p0: [], p1: [] },
    ...press(T + 5, 'p1', 'start'), ...press(T + 10, 'p0', 'right'), ...press(T + 40, 'p1', 'right'),
    ...press(T + 100, 'p0', 'north'), ...press(T + 140, 'p1', 'north'), { frame: T + 260, p0: [], p1: [] },
  ], 0));
  // both pick on frame T+40: player 1 left (knockback), player 2 right (dash)
  files['input-upgrade-tie.json'] = scriptText(compose(full.rows, T, [
    { frame: T + 1, p0: [], p1: [] },
    { frame: T + 40, p0: ['left'], p1: ['right'] }, { frame: T + 42, p0: [], p1: [] },
    ...press(T + 100, 'p0', 'north'), ...press(T + 140, 'p1', 'north'), { frame: T + 260, p0: [], p1: [] },
  ], 0));
  // player 1 alone; pad 2 appears at T+20 and presses start; player 1 picks the dash at T+60; the joiner uses its special at T+100
  const solo = botRows('nr_botsolo', 1500);
  const TS = phaseTick(solo.st, PH_UPGRADE);
  files['input-upgrade-join.json'] = scriptText(compose(solo.rows, TS, [
    { frame: TS + 1, p0: [], p1: [] },
    ...press(TS + 20, 'p1', 'start'), ...press(TS + 60, 'p0', 'right'), ...press(TS + 100, 'p1', 'north'), { frame: TS + 220, p0: [], p1: [] },
  ], TS + 20));
  // AE3: player 1 alone; pad 2 joins at J while wave 1 is on the street; a second start from it and one from player 1 do nothing
  const J = 200;
  files['input-join-mid.json'] = scriptText(compose(solo.rows, 800, [
    ...press(J, 'p1', 'start'), ...press(J + 60, 'p1', 'start'), ...press(J + 80, 'p0', 'start'),
  ], J));
  return files;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = generate();
  if (process.argv.includes('--check')) {
    const bad = Object.entries(files).filter(([n, t]) => { try { return readFileSync(join(DIR, n), 'utf8') !== t; } catch { return true; } });
    console.log(bad.length ? `differ: ${bad.map(([n]) => n).join(', ')}` : `${Object.keys(files).length} scripts are what the bots play`);
    process.exit(bad.length ? 1 : 0);
  }
  for (const [n, t] of Object.entries(files)) { writeFileSync(join(DIR, n), t); console.log(`${n}: ${t.split('\n').length - 3} entries`); }
}
