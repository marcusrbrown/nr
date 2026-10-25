// Writes games/nr/tests/input-look.json: the two-player script of the look gate's combat captures on `nr_look` (games/nr/main.c,
// NR_LOOK): real grunts and a heavy that stand still at three stations along the street.
//
//   node games/nr/tests/gen-input-look.mjs            write the file
//   node games/nr/tests/gen-input-look.mjs --check    exit 1 when the file differs from what this script generates
//
// The script is a list of holds, `[from, to, buttons]` for one player: the buttons are down on frames from .. to - 1. Frame 1 is
// neutral. Button names are the pad's: west attack, north special, l the special's dash variant.
// Player 0 (pad 1) fights; player 1 (pad 2) walks the same way a step behind and a lane further from the camera, so the
// captures show both heroes (and both players' accents) beside the enemies.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'input-look.json');
export const TICKS = 340;

const p0 = [], p1 = [];
const hold = (list, from, to, buttons) => { for (let t = from; t < to; t++) list[t] = [...(list[t] ?? []), ...buttons]; };
const tap = (list, at, ...buttons) => hold(list, at, at + 2, buttons);

// station 1: the dash special from the start, down the file of two grunts and the heavy
tap(p0, 40, 'north', 'l');
// station 2: player 1 walks up behind, then the radius special where the dash ended, in the middle of the crowd
hold(p1, 70, 100, ['right']);
tap(p0, 110, 'north');
// station 3: both heroes run to the pillar (two presses of right within 14 ticks make a run); player 0 stops 0.8 short of the grunt
tap(p0, 160, 'right'); hold(p0, 166, 210, ['right']);
tap(p1, 150, 'right'); hold(p1, 156, 215, ['right']);
tap(p0, 240, 'west');                                // hit1
tap(p0, 256, 'west');                                // hit2: a press in the recovery ticks of hit1
tap(p0, 272, 'west');                                // hit3

const buttonsAt = (list, t) => [...new Set(list[t] ?? [])].sort();
function entries() {
  const out = [];
  let last = null;
  for (let t = 1; t <= TICKS; t++) {
    const a = buttonsAt(p0, t), b = buttonsAt(p1, t), key = JSON.stringify([a, b]);
    if (key !== last) { out.push({ frame: t, buttons: a, pad2: { buttons: b } }); last = key; }
  }
  return out;
}
const text = () => `[\n${entries().map((e) => `  ${JSON.stringify(e)}`).join(',\n')}\n]\n`;

if (process.argv.includes('--check')) {
  const same = readFileSync(OUT, 'utf8') === text();
  console.log(same ? `input-look.json matches the generator (${entries().length} entries)` : 'input-look.json differs from the generator');
  process.exit(same ? 0 : 1);
}
writeFileSync(OUT, text());
console.log(`input-look.json: ${entries().length} entries, ${TICKS} ticks`);
