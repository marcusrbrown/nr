// Prints the whitelisted simulation state of a run-cart state file as canonical JSON, and exits 1 when a
// whitelisted field is missing or not finite. Compared exactly across hosts (docs/evidence/shipping-path-spike).
//   node games/spike/tests/whitelist.mjs <state.json> > whitelist.json
import { readFileSync } from 'node:fs';

const FIELDS = ['spike.pos', 'spike.jump', 'spike.rng', 'spike.actors', 'spike.sfx_tick', 'spike.voice_created',
  'spike.ticks', 'spike.input_count', 'spike.checksum'];
const state = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const out = {};
for (const k of FIELDS) {
  const v = state[k];
  if (v === undefined || [v].flat().some((n) => typeof n !== 'number' || !Number.isFinite(n))) {
    console.error(`whitelisted field ${k} is missing or not finite`);
    process.exit(1);
  }
  out[k] = v;
}
console.log(JSON.stringify(out));
