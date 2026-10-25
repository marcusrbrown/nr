// Writes games/nr/tests/input-waves.json: the two-player script of the four-wave run (sim-check.mjs), the input the bot
// in games/nr/main.c chooses when it plays both players on the `nr_bot` build, as the pad buttons a player holds.
// With --app nr_botfull --ticks N --out FILE it writes input-2p-full.json instead: the same bot on the build with a title,
// whose buttons include the starts that join and begin, the pick and, when the run is long enough, back.
//
//   node games/nr/tests/gen-input-waves.mjs            run nr_bot for TICKS ticks and write the script
//   node games/nr/tests/gen-input-waves.mjs --check    exit 1 when the file differs from what the bot plays now
//
// The bot reads only the simulation, so the same buttons through the pad path (the `nr` build under this script) give
// the same simulation: sim-check.mjs compares the two checksums. The script is a list of { frame, buttons, pad2 } the
// native platform applies from that frame on; it is the bot's `nr.bot_log` (tick, both players' button masks).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeWgpu, ROOT } from './capture-lib.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const APP = arg('app', 'nr_bot');
export const TICKS = Number(arg('ticks', 2700));
const OUT = arg('out') ? join(ROOT, arg('out')) : join(dirname(fileURLToPath(import.meta.url)), 'input-waves.json');
const BUTTON = [[1, 'right'], [2, 'left'], [4, 'up'], [8, 'down'], [16, 'west'], [32, 'south'], [64, 'east'], [128, 'north'], [256, 'r'], [512, 'l'], [1024, 'start'], [2048, 'back']];
const names = (mask) => BUTTON.filter(([bit]) => mask & bit).map(([, n]) => n);

/** Runs `app` (a build with a bot) for `ticks` ticks; returns { rows, st }: the bot's buttons as input-script rows and the final state. */
export function botRows(app = APP, ticks = TICKS) {
  const base = join(ROOT, `out/unit7/gen-${app}-${ticks}`);
  const r = nativeWgpu(app, base, ticks, { inputDir: join(ROOT, 'out/unit7/input') });
  if (r.status !== 0) throw new Error(`${app}: ${(r.stderr || r.stdout || '').slice(-300)}`);
  const st = JSON.parse(readFileSync(`${base}.json`, 'utf8'));
  const n = st['nr.bot_log_count'], log = st['nr.bot_log'];
  if (n > log.length / 2) throw new Error(`the bot log holds ${log.length / 2} of ${n} changes`);
  const rows = [{ frame: 1, buttons: [], pad2: { buttons: [] } }];
  for (let i = 0; i < n; i++) {
    const tick = log[i * 2], masks = log[i * 2 + 1] >>> 0;
    const p0 = masks & 0xffff, p1 = masks >>> 16;
    if (tick === 1) { rows[0] = { frame: 1, buttons: names(p0), pad2: { buttons: names(p1) } }; continue; }
    rows.push({ frame: tick, buttons: names(p0), pad2: { buttons: names(p1) } });
  }
  return { rows, st };
}

export const scriptText = (rows) => `[\n${rows.map((e) => `  ${JSON.stringify(e)}`).join(',\n')}\n]\n`;
export const generate = () => scriptText(botRows().rows);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.env.CW_TEST_GPU ||= 'desktop';
  const text = generate();
  if (process.argv.includes('--check')) {
    const same = readFileSync(OUT, 'utf8') === text;
    console.log(same ? `${OUT} is what the bot plays` : `${OUT} differs from what the bot plays`);
    process.exit(same ? 0 : 1);
  }
  writeFileSync(OUT, text);
  console.log(`${OUT}: ${text.split('\n').length - 3} entries, ${TICKS} ticks`);
}
