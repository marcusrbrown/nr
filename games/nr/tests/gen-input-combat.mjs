// Writes games/nr/tests/input-combat.json: the two-player script of the combat checks (sim-check.mjs), and
// games/nr/demo_combat.inc: the same script as the table the game plays when a host sets the debug field nr.demo.
//
//   node games/nr/tests/gen-input-combat.mjs            write both files
//   node games/nr/tests/gen-input-combat.mjs --check    exit 1 when either file differs from what this script generates
//   node games/nr/tests/gen-input-combat.mjs --shift N  write the script with every entry N frames later to stdout (the control)
//
// The script is a list of holds, each `[from, to, buttons]` for one player: the buttons are down on frames from .. to - 1
// (a press is the first frame of its hold, so two presses of one button need a gap). Frame 1 is neutral. Button names
// are the pad's: west attack, south jump, east grab, north special, l the special's dash variant, r dash.
//
// Player 1 (pad 2) walks left to the dummy that swings and is struck (a hit, a hit inside the invulnerability that hit
// gives, then a knockdown); it then walks and runs to the far end of the street, and overlaps player 0 for the
// friendly-fire check. Player 0 (pad 1) takes the test dummies in order:
//   30-65     combo: hit1, hit2 on a press in the recovery window, hit3 (a knockdown)
//   100-124   a press in the active ticks (no chain), then a late press (hit1 again)
//   172       grab on the grabbable dummy, throw, landing
//   230       grab on the dummy that cannot be grabbed (fails, recovers)
//   252-280   jump, then a kick on the way down
//   300       dash, then the radius special, then the dash special along the lane in front of the pillar
//   500       a plain jump (its length is the jump clip's)
//   600       player 0 attacks while player 1 stands inside the swing
//   650       player 0 walks left: it faces left
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'input-combat.json'), INC = join(HERE, '../demo_combat.inc');
export const TICKS = 760;

const p0 = [], p1 = [];
const hold = (list, from, to, buttons) => { for (let t = from; t < to; t++) list[t] = [...(list[t] ?? []), ...buttons]; };
const tap = (list, at, ...buttons) => hold(list, at, at + 2, buttons);

// player 1: walks left into the reach of the dummy that swings (ticks 80, 110, 170), waits out the knockdown, then
// crosses the street
hold(p1, 2, 52, ['left']);                           // x 0 -> -3.0: inside the swing of the dummy at -3.4
hold(p1, 252, 279, ['down']);                        // to lane 1.0, in front of the pillar's rectangle
tap(p1, 282, 'right'); tap(p1, 288, 'right');         // two presses of right within 14 ticks: a run
hold(p1, 288, 372, ['right']);                       // the run goes on while right is held
hold(p1, 480, 556, ['right']);                       // a walk to player 0, which stands at the end of the dash

// player 0
hold(p0, 2, 28, ['right']);                          // x 0 -> 1.56: 0.84 from the dummy at 2.4
tap(p0, 30, 'west');                                 // hit1
tap(p0, 45, 'west');                                 // hit2: tick 13 of hit1 is the first recovery tick
tap(p0, 60, 'west');                                 // hit3
tap(p0, 100, 'west');                                // hit1 ...
tap(p0, 108, 'west');                                // ... a press in its active ticks does not chain
tap(p0, 124, 'west');                                // a press after it ended: hit1 again
hold(p0, 147, 171, ['right']);
tap(p0, 172, 'east');                                // grab -> throw
hold(p0, 208, 228, ['right']);
tap(p0, 230, 'east');                                // grab on the ungrabbable dummy
tap(p0, 252, 'south');                               // jump
tap(p0, 277, 'west');                                // kick on the way down
tap(p0, 300, 'r');                                   // dash
hold(p0, 330, 342, ['right']);
tap(p0, 350, 'north');                               // special: knockback
hold(p0, 395, 410, ['down']);                        // to the lane in front of the pillar
tap(p0, 420, 'north', 'l');                          // special: dash
tap(p0, 500, 'south');                               // a plain jump
tap(p0, 600, 'west');                                // hit1 with player 1 inside the swing
hold(p0, 650, 658, ['left']);                        // player 0 turns to face left

const buttonsAt = (list, t) => [...new Set(list[t] ?? [])].sort();
function entries(shift = 0) {
  const out = [];
  let last = null;
  for (let t = 1; t <= TICKS; t++) {
    const a = buttonsAt(p0, t), b = buttonsAt(p1, t), key = JSON.stringify([a, b]);
    if (key !== last) { out.push({ frame: t === 1 ? 1 : t + shift, buttons: a, pad2: { buttons: b } }); last = key; }
  }
  return out;
}
const text = (list) => `[\n${list.map((e) => `  ${JSON.stringify(e)}`).join(',\n')}\n]\n`;

// the game's table: one row per entry, a bit per button (NR_DEMO_* in main.c)
const BIT = { right: 1, left: 2, up: 4, down: 8, west: 16, south: 32, east: 64, north: 128, r: 256, l: 512 };
const mask = (list) => list.reduce((m, b) => m | BIT[b], 0);
const inc = () => `/* Generated by tests/gen-input-combat.mjs from tests/input-combat.json: the combat script as the game plays it when a host
 * sets nr.demo. Each row is a frame and the buttons of each player from that frame on: right 1, left 2, up 4, down 8,
 * attack 16, jump 32, grab 64, special 128, dash 256, special's dash variant 512. */
#define NR_DEMO_TICKS ${TICKS}
static const struct { int32_t frame; uint16_t p0, p1; } NR_DEMO_COMBAT[] = {
${entries().map((e) => `  { ${e.frame}, ${mask(e.buttons)}, ${mask(e.pad2.buttons)} },`).join('\n')}
};
`;

const shiftArg = process.argv.indexOf('--shift');
if (shiftArg >= 0) { process.stdout.write(text(entries(+process.argv[shiftArg + 1]))); process.exit(0); }
if (process.argv.includes('--check')) {
  const same = readFileSync(OUT, 'utf8') === text(entries()) && readFileSync(INC, 'utf8') === inc();
  console.log(same ? `input-combat.json and demo_combat.inc match the generator (${entries().length} entries)` : 'input-combat.json or demo_combat.inc differs from the generator');
  process.exit(same ? 0 : 1);
}
writeFileSync(OUT, text(entries()));
writeFileSync(INC, inc());
console.log(`input-combat.json and demo_combat.inc: ${entries().length} entries, ${TICKS} ticks`);
