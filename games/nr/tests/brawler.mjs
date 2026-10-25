// The brawler gate's scripts, the whitelisted state fields every host must reproduce exactly, and the predicate that
// holds a run to the committed golden (goldens.json) and to the facts its script exists to show.
//
// A host passes the brawler gate on a script when its whitelisted state equals the native binary's (the stock and strict
// predicates of tests/gates.json) and `brawlerProblems` finds nothing on its state: the final checksum equals the golden,
// every field the golden records is equal, and the script's requirements hold (title to clear, wave index 4 reached, both
// players alive at the end).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const GOLDENS = join(ROOT, 'games/nr/tests/goldens.json');
const T = 'games/nr/tests/';

/** id: the script's name in goldens.json; gate: the stem of its tests/gates.json entries; need: requirements checked on the final state.
 * `frames` is the last frame of the run, chosen where the picture is still changing so that the image predicate can see a
 * one-frame shift: 2164 is the tick the arena is cleared (the clear screen appears), 2374 the tick the last wave ends in
 * the waves script, 658 the last input of the combat script. The clear screens are static afterwards (the simulation stops
 * and the only thing that moves is the prompt's blink). */
export const SCRIPTS = [
  { id: '2p-full', gate: 'nr-2p-full', app: 'nr', input: `${T}input-2p-full.json`, frames: 2164, need: ['phase-clear', 'cleared', 'wave-4', 'heroes-alive', 'two-players'] },
  { id: 'waves', gate: 'nr-waves', app: 'nr_waves', input: `${T}input-waves.json`, frames: 2374, need: ['cleared', 'wave-4', 'heroes-alive', 'two-players'] },
  { id: 'combat', gate: 'nr-combat', app: 'nr_dummies', input: `${T}input-combat.json`, frames: 658, need: ['heroes-alive', 'two-players'] },
  { id: 'join-mid', gate: 'nr-join-mid', app: 'nr', input: `${T}input-join-mid.json`, frames: 800, need: ['heroes-alive', 'joined-once', 'two-players'] },
  { id: 'upgrade', gate: 'nr-upgrade', app: 'nr', input: `${T}input-upgrade.json`, frames: 989, need: ['heroes-alive', 'dash-picked', 'two-players'] },
];

/** the state every host must reproduce exactly (the actors, the rng, the camera, lights, lives, waves, phase, sounds asked for, the event log, the checksums) */
export const FIELDS = ['nr.ticks', 'nr.hero_pos', 'nr.hero_clip', 'nr.hero_step', 'nr.hero_frame', 'nr.light_pos', 'nr.light_intensity', 'nr.cam_x', 'nr.cam_left',
  'nr.checksum', 'nr.sim_checksum', 'nr.actor_y', 'nr.actor_vy', 'nr.actor_state', 'nr.actor_state_tick', 'nr.actor_hp', 'nr.actor_facing', 'nr.actor_team', 'nr.actor_invuln',
  'nr.actor_kind', 'nr.actor_target', 'nr.actor_away', 'nr.actor_present', 'nr.rng', 'nr.wave', 'nr.lives', 'nr.input_count', 'nr.event_count', 'nr.events', 'nr.events_dropped',
  'nr.game_over', 'nr.start_refused', 'nr.upgrade_ready', 'nr.cleared', 'nr.wave_phase', 'nr.players', 'nr.phase', 'nr.special_variant', 'nr.pick_player', 'nr.joins',
  'nr.ignored_starts', 'nr.sfx_count', 'nr.sfx_tick'];

/** the fields a golden records beside the checksum, in the order they are compared */
export const FINAL_FIELDS = ['nr.ticks', 'nr.input_count', 'nr.phase', 'nr.wave', 'nr.cleared', 'nr.game_over', 'nr.lives', 'nr.players', 'nr.joins', 'nr.special_variant',
  'nr.actor_hp', 'nr.actor_state', 'nr.sim_checksum'];

const PH_CLEAR = 3, ST_DEAD = 18; // nr_phase NR_PH_CLEAR, nr_state NR_ST_DEAD (sim.h)

export function readGoldens() {
  if (!existsSync(GOLDENS)) return null;
  return JSON.parse(readFileSync(GOLDENS, 'utf8'));
}

const alive = (st, p) => Array.isArray(st['nr.actor_hp']) && st['nr.actor_hp'][p] > 0 && st['nr.actor_state'][p] !== ST_DEAD && st['nr.actor_present'][p] === 1;
const NEED = {
  'phase-clear': [(st) => st['nr.phase'] === PH_CLEAR, 'game state is not clear'],
  cleared: [(st) => st['nr.cleared'] === 1 && st['nr.wave_phase'] === 2, 'the last wave did not end'],
  'wave-4': [(st) => st['nr.wave'] >= 4, 'wave index 4 not reached'],
  'heroes-alive': [(st) => alive(st, 0) && alive(st, 1), 'a scripted player is not alive'],
  'two-players': [(st) => st['nr.players'] === 2, 'not two players'],
  'joined-once': [(st) => st['nr.joins'] === 1, 'the mid-fight join did not happen exactly once'],
  'dash-picked': [(st) => st['nr.special_variant'] === 1, 'the dash special was not picked'],
};

/** problems of a final state against the golden and the script's requirements; [] when the run is the brawler run */
export function brawlerProblems(id, st, goldens = readGoldens()) {
  const script = SCRIPTS.find((s) => s.id === id);
  const out = [];
  const g = goldens?.scripts?.[id];
  if (!script || !g) return [`no golden for ${id} in goldens.json`];
  if (!Number.isInteger(st['nr.checksum'])) out.push('nr.checksum is missing or not an integer');
  else if (st['nr.checksum'] !== g.checksum) out.push(`nr.checksum ${st['nr.checksum']} is not the golden ${g.checksum}`);
  for (const f of FINAL_FIELDS) if (JSON.stringify(st[f]) !== JSON.stringify(g.final[f])) out.push(`${f} ${JSON.stringify(st[f])} is not the golden ${JSON.stringify(g.final[f])}`);
  for (const n of script.need) if (!NEED[n][0](st)) out.push(NEED[n][1]);
  return out;
}
