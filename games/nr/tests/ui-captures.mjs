// The Unit 7 capture set on WebGPU: the title, the HUD in the fight, the upgrade screen and the clear screen of
// input-2p-full.json, each on the native binary and on the dual cart in headless Chromium, with an equality line per
// capture: the simulation state (the fields the hosts compare) equal, and the two screenshots' pixel difference.
//
//   CW_TEST_GPU=desktop node games/nr/tests/ui-captures.mjs [--out out/unit7/captures] [--publish docs/evidence/combat-slice/unit7/captures]
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { decodePng } from '../../../tools/render/post.mjs';
import { cartWgpu, nativeWgpu, ROOT } from './capture-lib.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const OUT = resolve(ROOT, opt('out', 'out/unit7/captures')), PUBLISH = opt('publish') ? resolve(ROOT, opt('publish')) : null;
mkdirSync(OUT, { recursive: true });
const INPUT = 'games/nr/tests/input-2p-full.json';
const SHOTS = [['title', 30], ['hud-fight', 1000], ['upgrade', 765], ['clear', 2250]];
const SIM = ['nr.ticks', 'nr.hero_pos', 'nr.hero_clip', 'nr.hero_step', 'nr.hero_frame', 'nr.cam_x', 'nr.checksum', 'nr.sim_checksum', 'nr.actor_state', 'nr.actor_hp', 'nr.actor_present', 'nr.rng', 'nr.wave', 'nr.lives',
  'nr.event_count', 'nr.events', 'nr.phase', 'nr.special_variant', 'nr.pick_player', 'nr.joins', 'nr.sfx_count', 'nr.sfx_tick', 'nr.players'];
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

let failed = 0;
const rows = [];
for (const [name, frame] of SHOTS) {
  const nat = join(OUT, `${name}-native`), cart = join(OUT, `${name}-cart`);
  const rn = nativeWgpu('nr', nat, frame, { input: INPUT, inputDir: join(OUT, 'input') }), rc = cartWgpu('nr', cart, frame, { input: INPUT });
  if (rn.status !== 0 || rc.status !== 0) { failed++; console.log(`FAIL ${name}: native ${rn.status} cart ${rc.status} ${(rc.stderr || rc.stdout || '').slice(-200)}`); continue; }
  const a = readJson(`${nat}.json`), b = readJson(`${cart}.json`);
  const stateEqual = SIM.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));
  const pa = decodePng(readFileSync(`${nat}.png`)), pb = decodePng(readFileSync(`${cart}.png`));
  let differing = 0, maxd = 0, sum = 0;
  const same = pa.width === pb.width && pa.height === pb.height;
  if (same) for (let i = 0; i < pa.width * pa.height; i++) {
    const d = Math.max(Math.abs(pa.data[i * 4] - pb.data[i * 4]), Math.abs(pa.data[i * 4 + 1] - pb.data[i * 4 + 1]), Math.abs(pa.data[i * 4 + 2] - pb.data[i * 4 + 2]));
    if (d > 0) { differing++; sum += d; if (d > maxd) maxd = d; }
  }
  const row = { name, frame, phase: a['nr.phase'], wave: a['nr.wave'], lives: a['nr.lives'], missing: [a['cw.three.missing'], b['cw.three.missing']], glyphsMissing: [a['nr.ui_glyphs_missing'], b['nr.ui_glyphs_missing']], stateEqual, size: [pa.width, pa.height, pb.width, pb.height],
    pixelsDiffering: differing, maxChannelDiff: maxd, share: same ? differing / (pa.width * pa.height) : 1 };
  const ok = stateEqual && same && row.missing.every((m) => m === 0) && row.glyphsMissing.every((m) => m === 0);
  if (!ok) failed++;
  rows.push({ ...row, ok });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} @${frame}: phase ${row.phase}, wave ${row.wave}, lives ${row.lives}; native and cart state ${stateEqual ? 'equal' : 'DIFFERS'}; cw.three.missing ${row.missing.join('/')}; ${pa.width}x${pa.height}; pixels differing ${differing} (${(row.share * 100).toFixed(3)}%, max channel ${maxd})`);
}
writeFileSync(join(OUT, 'captures.json'), `${JSON.stringify({ input: INPUT, compared: SIM, rows }, null, 2)}\n`);
if (PUBLISH) {
  mkdirSync(PUBLISH, { recursive: true });
  for (const [name] of SHOTS) copyFileSync(join(OUT, `${name}-native.png`), join(PUBLISH, `${name}-native.png`)), copyFileSync(join(OUT, `${name}-cart.png`), join(PUBLISH, `${name}-cart.png`));
  copyFileSync(join(OUT, 'captures.json'), join(PUBLISH, 'captures.json'));
}
console.log(failed ? `${failed} capture(s) failed` : `${rows.length} captures: native and cart state equal, cw.three.missing 0, glyphs missing 0`);
process.exit(failed ? 1 : 0);
