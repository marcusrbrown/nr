// Shared by the shockwave checks (fx-check.mjs, look-set.mjs): the effect's constants as games/nr/main.c defines them, the ring's
// radius, colour scale and flash as the C computes them from the special's state tick, and where the ring lies on the screen.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { camera, project, ROOT } from './look-lib.mjs';

/** The FX_* numbers of games/nr/main.c, read from the source so a change there is seen here. */
export function fxConstants(src = readFileSync(join(ROOT, 'games/nr/main.c'), 'utf8')) {
  const out = {};
  for (const m of src.matchAll(/^#define (FX_[A-Z_]+)\s+(-?[\d.]+)f?\b/gm)) out[m[1]] = +m[2];
  return out;
}

/** The state table's numbers of the radius special (games/nr/sim.c DEF): total ticks, startup, active ticks, radius. */
export function specialDef(src = readFileSync(join(ROOT, 'games/nr/sim.c'), 'utf8')) {
  const m = src.match(/\[NR_ST_SPECIAL_KNOCKBACK\] = \{ \{ "special_knockback", (\d+), (\d+), (\d+) \}, SHAPE_RADIUS, [\d.f]+, ([\d.]+)f/);
  if (!m) throw new Error('the special_knockback row of games/nr/sim.c is not in the expected form');
  return { total: +m[1], startup: +m[2], active: +m[3], radius: +m[4] };
}

const f32 = Math.fround;
/** What fx_ring_at / fx_flash_at make of tick `t` of the special's state: { radius, scale, flash } (all 0 outside the effect's ticks). */
export function fxAt(t, c = fxConstants(), d = specialDef()) {
  const k = t - d.startup, out = { radius: 0, scale: 0, flash: 0 };
  if (k >= 0 && k < c.FX_TICKS) {
    const p = Math.min(1, (k + 1) / d.active), left = 1 - k / c.FX_TICKS;
    out.radius = f32(d.radius * (1 - (1 - p) * (1 - p)));
    out.scale = f32(left * left);
  }
  if (k >= 0 && k < c.FX_FLASH_TICKS) { const left = 1 - k / c.FX_FLASH_TICKS; out.flash = f32(c.FX_FLASH_PEAK * left * left); }
  return out;
}

/** The ring's samples on the screen for player `p` of a state (the debug state of a capture): the world points on the ring's mid band
 * (the ring spans FX_RING_INNER to 1 of the radius), their pixels at 1920x1080 and the world z, every `step` degrees. */
export function ringSamples(st, p, c = fxConstants(), step = 5) {
  const r = st['nr.fx_radius'][p], cam = camera(st['nr.cam_x']);
  const x = st['nr.hero_pos'][p * 3], lane = st['nr.hero_pos'][p * 3 + 1], mid = r * (1 + c.FX_RING_INNER) / 2;
  const out = [];
  for (let a = 0; a < 360; a += step) {
    const w = [x + mid * Math.cos(a * Math.PI / 180), c.FX_Y, lane + mid * Math.sin(a * Math.PI / 180)];
    const [px, py] = project(cam, w);
    out.push({ angle: a, world: w, px: Math.round(px), py: Math.round(py) });
  }
  return out;
}

const TINT = {
  0: (r, g, b) => r - g > 45 && b - g > 25,   // magenta: the HUD's player 1
  1: (r, g, b) => g - r > 40 && b - r > 40,   // cyan: player 2
};
/** How much of the ring shows on a capture: the samples that fall in the frame, are on the street (not behind the curb, z -1.8) and
 * carry the player's colour. `img` is a decoded PNG (readImage). */
export function ringOnScreen(st, p, img, c = fxConstants()) {
  const s = ringSamples(st, p, c).filter((q) => q.px >= 1 && q.px < img.w - 1 && q.py >= 1 && q.py < img.h - 1 && q.world[2] > -1.8);
  let tinted = 0;
  for (const q of s) {
    // the 3x3 block around the sample: one of its pixels carrying the colour is enough (the ring's edge is a pixel wide at its thinnest)
    let hit = false;
    for (let dy = -1; dy <= 1 && !hit; dy++) for (let dx = -1; dx <= 1 && !hit; dx++) {
      const o = ((q.py + dy) * img.w + q.px + dx) * 4;
      hit = TINT[p](img.rgba[o], img.rgba[o + 1], img.rgba[o + 2]);
    }
    if (hit) tinted++;
  }
  return { samples: s.length, tinted, fraction: s.length ? tinted / s.length : 0 };
}
