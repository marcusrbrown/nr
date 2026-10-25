// Generates layout.json: the street block of games/nr/arena.c, as a list of boxes, planes and decals.
//
//   node games/nr/assets/arena/gen-arena.mjs            write layout.json next to this script
//   node games/nr/assets/arena/gen-arena.mjs --check    exit 1 when layout.json differs from what this script generates
//
// Deterministic: a fixed-seed integer generator and values rounded to 1/1000. World units: x runs along the street,
// y is up, z is the lane (a larger z is nearer the camera). One world unit is 64 scene pixels at the belt's centre
// lane. The street is three screens (30 units) wide, x -5 to 25; the play lane runs from LANE_MIN to LANE_MAX.
//
// Layers: near = shop fronts behind the sidewalk, far = the buildings behind them, mid = a lower row of dark buildings
// behind those, backdrop = the sky, the haze and the skyline of distant towers,
// play = the pillar that stands in the play lane (it blocks movement and occludes actors behind it), ground = street
// surface and markings.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'layout.json');

const LANE_MIN = -1.6, LANE_MAX = 1.8;
const X_MIN = -4.0, X_MAX = 24.0; // where an actor's ground point may stand; the camera shows x -5 to 25

let seed = 0x4e52; // "NR"
const rand = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 8) / 0x1000000; };
const r3 = (v) => Math.round(v * 1000) / 1000;
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
const pick = (list) => list[Math.floor(rand() * list.length)];

// signs: the four reference colours below are used once each, so the parallax check can find them by colour
const NEON = [0xff2bd6, 0x20e8ff, 0xffa020, 0xf4f4ff, 0xff5fa0];
const REF = { nearSign: 0x39ff14, farSign: 0x5a4cff, pillarBand: 0xff1a1a, skyWindow: 0xb0ff00, x: 12.6 };
const WINDOW = [0xffcf70, 0x8fe8ff, 0xffe2b0, 0xff9ad0];
const SHOP = [0x2c3144, 0x3b2f48, 0x28383f, 0x44353a, 0x2f3b50, 0x383044];
const AWNING = [0x7a2f4f, 0x2f6a7a, 0x7a5a2f, 0x4f3f7a];
const TOWER = [0x1f2333, 0x232a3b, 0x1b2030, 0x262336];
const MID = [0x161a29, 0x181d2e, 0x141828, 0x1a1a2c];

const solids = [];
const add = (s) => solids.push(Object.fromEntries(Object.entries({ blocks: undefined, ...s }).filter(([, v]) => v !== undefined).map(([k, v]) => [k, typeof v === 'number' ? r3(v) : v])));
const box = (id, layer, x, y, z, w, h, d, color, extra = {}) => add({ id, layer, shape: 'box', x, y, z, w, h, d, color: hex(color), ...(extra.emissive != null ? { emissive: hex(extra.emissive), emissive_intensity: extra.intensity ?? 1 } : {}), ...(extra.blocks ? { blocks: true } : {}) });

// ground: street surface (never in the depth buffer, so an actor's feet below its pivot are not cut), markings
add({ id: 'street', layer: 'ground', shape: 'decal', x: 10, y: 0, z: 0.8, w: 46, d: 9.6, color: '#2b2f3d', order: -10 });
for (let i = 0; i < 8; i++) add({ id: `dash-${i}`, layer: 'ground', shape: 'decal', x: -4 + i * 4, y: 0.005, z: -1.0, w: 1.6, d: 0.12, color: '#8a8fa5', order: -9 });
box('sidewalk', 'ground', 10, 0.06, -2.75, 46, 0.12, 1.7, 0x3a3f50);
box('curb', 'ground', 10, 0.08, -1.9, 46, 0.16, 0.1, 0x555b70);

// near layer: shop fronts, facade plane z = -2.75
const FACE_Z = -2.75;
const shops = [];
for (let x = -8; x < 28;) {
  const w = r3(3.0 + Math.floor(rand() * 15) / 10);
  shops.push({ cx: r3(x + w / 2), w });
  x += w + 0.5;
}
const refShop = shops.reduce((b, s, i) => (Math.abs(s.cx - REF.x) < Math.abs(shops[b].cx - REF.x) ? i : b), 0);
shops.forEach((s, i) => {
  const n = String(i).padStart(2, '0');
  box(`shop-${n}`, 'near', s.cx, 1.35, FACE_Z - 0.5, s.w, 2.7, 1.0, pick(SHOP));
  box(`shop-${n}-window`, 'near', s.cx - s.w * 0.12, 1.2, FACE_Z + 0.02, s.w * 0.42, 0.95, 0.06, 0x151820, { emissive: pick(WINDOW), intensity: 0.18 });
  box(`shop-${n}-door`, 'near', s.cx + s.w * 0.3, 0.95, FACE_Z + 0.02, 0.9, 1.9, 0.06, 0x1a1c26);
  box(`shop-${n}-awning`, 'near', s.cx, 2.2, FACE_Z + 0.35, s.w * 0.9, 0.16, 0.7, pick(AWNING));
  box(`shop-${n}-sign`, 'near', s.cx, 2.5, FACE_Z + 0.05, s.w * 0.7, 0.26, 0.08, 0x101010, { emissive: i === refShop ? REF.nearSign : pick(NEON), intensity: 1.4 });
});
// colonnade on the sidewalk, in front of each alley between shops
for (let i = 0; i < shops.length - 1; i++) {
  const x = (shops[i].cx + shops[i].w / 2 + shops[i + 1].cx - shops[i + 1].w / 2) / 2;
  box(`column-${String(i).padStart(2, '0')}`, 'near', x, 1.5, -2.2, 0.5, 3.0, 0.5, 0x4a5062);
}

// far layer: buildings behind the shop fronts, facade plane z = -5.5. The belt camera looks 20 degrees down, so the
// top of the frame at this depth is y 3.33: the buildings stop at 2.75 to 3.4 and what shows above the lower ones is the
// mid and skyline layers behind them.
// The far row has one wide gap, FAR_GAP, and the skyline's reference window stands behind it: the scroll check follows
// that window while the camera moves 4.44 units, and it has to stay in view through a gap at both ends of the move.
// The far tower with the reference sign ends where the gap begins, so its sign stays in view through that move too.
const FAR_GAP = [16.4, 20.0], SKY_REF_X = 18.6, REF_TOWER = { cx: 14.6, w: 3.4 };
const towers = [];
for (let x = -10; x < 30;) {
  const w = r3(3.2 + Math.floor(rand() * 15) / 10);
  const cx = r3(x + w / 2);
  if (cx + w / 2 > REF_TOWER.cx - REF_TOWER.w / 2 - 0.1 && cx - w / 2 < FAR_GAP[1] + 0.1) x = FAR_GAP[1] + 0.1;
  else { towers.push({ cx, w }); x += w + r3(1.8 + Math.floor(rand() * 17) / 10); }
}
towers.push(REF_TOWER);
towers.sort((a, b) => a.cx - b.cx);
const refTower = towers.indexOf(REF_TOWER);
towers.forEach((s, i) => {
  const n = String(i).padStart(2, '0');
  const h = i === refTower ? 3.2 : 2.75 + Math.floor(rand() * 7) / 10;
  box(`tower-${n}`, 'far', s.cx, h / 2, -6.3, s.w, h, 1.6, pick(TOWER));
  box(`tower-${n}-band-a`, 'far', s.cx, 2.45, -5.48, s.w * 0.78, 0.2, 0.05, 0x10131c, { emissive: pick(WINDOW), intensity: 0.18 });
  box(`tower-${n}-band-b`, 'far', s.cx, 2.85, -5.48, s.w * 0.78, 0.2, 0.05, 0x10131c, { emissive: pick(WINDOW), intensity: 0.18 });
  box(`tower-${n}-sign`, 'far', s.cx + s.w * 0.36, h - 0.45, -5.44, 0.35, 0.8, 0.08, 0x101010, { emissive: i === refTower ? REF.farSign : pick(NEON), intensity: 1.3 });
});
// tall piers between the near and far rows
for (const x of [-3, 5, 13, 21, 29]) box(`pier-${x}`, 'far', x, 2.1, -4.4, 0.9, 4.2, 0.9, 0x3c4254);

// mid layer: a row of lower dark buildings at z = -10.5 (frame top y 2.35 there; the buildings stop at 0.8 to 1.6 so the skyline shows above them) with a few lit windows
const MID_Z = -10.5;
for (let x = -14, i = 0; x < 34; i++) {
  const w = r3(2.4 + Math.floor(rand() * 20) / 10), h = 0.8 + Math.floor(rand() * 9) / 10;
  const cx = r3(x + w / 2);
  box(`mid-${String(i).padStart(2, '0')}`, 'mid', cx, h / 2, MID_Z, w, h, 1.4, pick(MID), { emissive: 0x121830, intensity: 0.6 });
  for (let k = 0; k < 3; k++) {
    if (rand() < 0.45) continue;
    box(`mid-${String(i).padStart(2, '0')}-window-${k}`, 'mid', r3(cx - w * 0.3 + k * w * 0.3), r3(0.3 + rand() * (h - 0.5)), MID_Z + 0.72, 0.18, 0.22, 0.04, 0x0c0e18, { emissive: pick(WINDOW), intensity: 0.9 });
  }
  x += w + r3(0.2 + Math.floor(rand() * 8) / 10);
}

// backdrop: the sky, a haze that glows toward the horizon, and the skyline: dark silhouettes of distant towers at
// z = -15.4 (frame top y 1.4 there) with a few lit windows and aerials
add({ id: 'sky', layer: 'backdrop', shape: 'plane', x: 10, y: 12, z: -16, w: 90, h: 30, color: '#151a2e', emissive: hex(0x1a2246), emissive_intensity: 0.5 });
[[0.1, 0.8, 0xc23fa0, 1.0], [0.8, 0.6, 0x8a35b0, 0.95], [1.3, 0.8, 0x4a3aa0, 0.9]].forEach(([y, h, c, k], i) => add({ id: `haze-${i}`, layer: 'backdrop', shape: 'plane', x: 10, y, z: -15.95, w: 90, h, color: '#151a2e', emissive: hex(c), emissive_intensity: k }));
const SKY_Z = -15.4;
for (let x = -18, i = 0; x < 38; i++) {
  const w = r3(1.4 + Math.floor(rand() * 22) / 10), h = r3(0.6 + Math.floor(rand() * 75) / 100);
  const cx = r3(x + w / 2), n = String(i).padStart(2, '0');
  box(`skyline-${n}`, 'backdrop', cx, h / 2, SKY_Z, w, h, 1.2, 0x0b0e1a, { emissive: 0x141a3c, intensity: 0.55 });
  if (rand() < 0.5) box(`skyline-${n}-aerial`, 'backdrop', r3(cx + w * 0.2), h + 0.2, SKY_Z, 0.04, 0.4, 0.04, 0x0b0e1a, { emissive: 0x141a3c, intensity: 0.55 });
  for (let k = 0; k < 5; k++) {
    if (rand() < 0.45) continue;
    box(`skyline-${n}-window-${k}`, 'backdrop', r3(cx - w * 0.38 + rand() * w * 0.76), r3(0.2 + rand() * (h - 0.35)), SKY_Z + 0.62, 0.18, 0.2, 0.03, 0x0a0c14, { emissive: pick(WINDOW), intensity: 1.2 });
  }
  x += w + r3(0.1 + Math.floor(rand() * 5) / 10);
}
// the skyline's reference: a tower of its own behind the far row's gap, with a window of a colour used nowhere else
box('skyline-ref', 'backdrop', SKY_REF_X, 0.65, SKY_Z, 1.4, 1.3, 1.2, 0x0b0e1a, { emissive: 0x141a3c, intensity: 0.55 });
box('skyline-ref-window', 'backdrop', SKY_REF_X, 0.95, SKY_Z + 0.62, 0.22, 0.24, 0.03, 0x0a0c14, { emissive: REF.skyWindow, intensity: 1.0 });

// play lane: the pillar. Its front face is at z = PILLAR_Z + d / 2.
const P = { x: 12.0, z: -0.15, w: 1.2, h: 3.2, d: 0.5 };
box('pillar', 'play', P.x, P.h / 2, P.z, P.w, P.h, P.d, 0x6a7080, { blocks: true });
box('pillar-band', 'play', P.x, 2.5, P.z, P.w + 0.04, 0.14, P.d + 0.04, 0x101010, { emissive: REF.pillarBand, intensity: 1.2 });

const layout = {
  bounds: { x_min: X_MIN, x_max: X_MAX, lane_min: LANE_MIN, lane_max: LANE_MAX, street_x_min: -5, street_x_max: 25 },
  reference: { near_sign: hex(REF.nearSign), far_sign: hex(REF.farSign), pillar_band: hex(REF.pillarBand), sky_window: hex(REF.skyWindow), x: REF.x },
  solids,
};
const text = `{\n"bounds": ${JSON.stringify(layout.bounds)},\n"reference": ${JSON.stringify(layout.reference)},\n"solids": [\n${solids.map((s) => JSON.stringify(s)).join(',\n')}\n]\n}\n`;
if (process.argv.includes('--check')) {
  const same = readFileSync(OUT, 'utf8') === text;
  console.log(same ? `layout.json matches the generator (${solids.length} solids)` : 'layout.json differs from the generator');
  process.exit(same ? 0 : 1);
}
writeFileSync(OUT, text);
console.log(`layout.json: ${solids.length} solids`);
