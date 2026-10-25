// Runs each Unit 6 script on four hosts and compares them: the native binary and the dual cart on WebGPU, and the native
// binary and the GL cart on GL. Records cw.three.missing on each, and whether the simulation state (checksum, every actor,
// the rng, lives, wave, the event log) is equal between each host and the native WebGPU run.
//
//   CW_TEST_GPU=desktop node games/nr/tests/waves-hosts.mjs [--out out/unit6/hosts] [--publish docs/evidence/combat-slice/unit6]
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartWgpu, nativeWgpu } from './capture-lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const OUT = resolve(ROOT, opt('out', 'out/unit6/hosts')), PUBLISH = opt('publish') ? resolve(ROOT, opt('publish')) : null;
mkdirSync(OUT, { recursive: true });

const T = 'games/nr/tests/';
const RUNS = [
  { name: 'waves', app: 'nr', input: `${T}input-waves.json`, frames: 2700 },
  { name: 'bot', app: 'nr_bot', input: `${T}input-idle.json`, frames: 2700 },
  { name: 'solo', app: 'nr', input: `${T}input-waves-solo.json`, frames: 6000 },
  { name: 'disconnect', app: 'nr', input: `${T}input-waves-disconnect.json`, frames: 700 },
  { name: 'retarget', app: 'nr_bot1', input: `${T}input-idle.json`, frames: 4200 },
];
const SIM = ['nr.ticks', 'nr.hero_pos', 'nr.hero_clip', 'nr.hero_step', 'nr.hero_frame', 'nr.light_pos', 'nr.light_intensity', 'nr.cam_x', 'nr.cam_left', 'nr.checksum', 'nr.sim_checksum', 'nr.actor_y', 'nr.actor_vy',
  'nr.actor_state', 'nr.actor_state_tick', 'nr.actor_hp', 'nr.actor_facing', 'nr.actor_team', 'nr.actor_invuln', 'nr.actor_kind', 'nr.actor_target', 'nr.actor_away', 'nr.actor_present', 'nr.rng', 'nr.wave', 'nr.lives',
  'nr.input_count', 'nr.event_count', 'nr.events', 'nr.events_dropped', 'nr.game_over', 'nr.start_refused', 'nr.upgrade_ready', 'nr.cleared', 'nr.wave_phase', 'nr.players'];
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const glRun = (host, app, state, input, frames) => spawnSync('node', ['deps/cartwheel-engine/tools/run-cart.mjs', '--host', host === 'native-gl' ? 'native' : 'chromium', '--app', app,
  ...(host === 'cart-gl' ? ['--cart', join(ROOT, 'build/cart/carts', `${app}.wasc`)] : []), '--frames', String(frames), '--state', state, '--gpu', 'gl', '--input', input],
{ cwd: ROOT, encoding: 'utf8', env: { ...process.env, CW_PROJECT_ROOT: ROOT, CW_TEST_GPU: process.env.CW_TEST_GPU || 'desktop' } });

const rows = [];
let failed = 0;
for (const r of RUNS) {
  const row = { name: r.name, app: r.app, input: r.input, frames: r.frames, hosts: {} };
  const states = {};
  const nat = join(OUT, `${r.name}-native-wgpu`), cart = join(OUT, `${r.name}-cart-wgpu`);
  const rn = nativeWgpu(r.app, nat, r.frames, { input: r.input, inputDir: join(OUT, 'input') }), rc = cartWgpu(r.app, cart, r.frames, { input: r.input });
  if (rn.status === 0) states['native-wgpu'] = readJson(`${nat}.json`);
  if (rc.status === 0) states['cart-wgpu'] = readJson(`${cart}.json`);
  for (const host of ['native-gl', 'cart-gl']) {
    const f = join(OUT, `${r.name}-${host}.json`), g = glRun(host, r.app, f, r.input, r.frames);
    if (g.status === 0) states[host] = readJson(f);
  }
  const base = states['native-wgpu'];
  for (const host of ['native-wgpu', 'cart-wgpu', 'native-gl', 'cart-gl']) {
    const st = states[host];
    if (!st) { row.hosts[host] = { error: 'run failed' }; failed++; continue; }
    const equal = SIM.every((k) => JSON.stringify(st[k]) === JSON.stringify(base?.[k]));
    row.hosts[host] = { missing: st['cw.three.missing'], checksum: st['nr.checksum'], ticks: st['nr.ticks'], simStateEqualToNativeWebGPU: equal };
    if (st['cw.three.missing'] !== 0 || !equal) failed++;
  }
  rows.push(row);
  console.log(`${r.name.padEnd(11)} ${r.app.padEnd(8)} ${r.frames}: ${Object.entries(row.hosts).map(([h, v]) => `${h} missing ${v.missing ?? v.error} state ${v.simStateEqualToNativeWebGPU ? 'equal' : 'DIFFERS'}`).join(' | ')}`);
}
writeFileSync(join(OUT, 'waves-hosts.json'), `${JSON.stringify({ hosts: ['native-wgpu', 'cart-wgpu', 'native-gl', 'cart-gl'], compared: SIM, runs: rows }, null, 2)}\n`);
if (PUBLISH) { mkdirSync(PUBLISH, { recursive: true }); copyFileSync(join(OUT, 'waves-hosts.json'), join(PUBLISH, 'waves-hosts.json')); }
console.log(failed ? `${failed} host check(s) failed` : `${rows.length} scripts on 4 hosts: cw.three.missing 0 and equal state everywhere`);
process.exit(failed ? 1 : 0);
