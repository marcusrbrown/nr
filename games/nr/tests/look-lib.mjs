// Shared by the nr look checks: the belt camera of games/nr/main.c (constants repeated here, so a change to main.c
// without this file fails the registration checks), the hero atlas as the checks read it, and image helpers.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const { readImage } = await import(join(ROOT, 'deps/cartwheel-engine/tools/lib/png.mjs'));
export { readImage };

export const CAM = { ppu: 64, pitchDeg: 20, fovDeg: 18, sceneW: 640, sceneH: 360, groundPxBelowCentre: 100, scale: 3 };

const rad = (d) => (d * Math.PI) / 180;
const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a); return a.map((v) => v / l); };

/** The belt camera for a camera x, as place_camera() in main.c builds it. */
export function camera(camX = 0) {
  const sp = Math.sin(rad(CAM.pitchDeg)), cp = Math.cos(rad(CAM.pitchDeg));
  const dist = (CAM.sceneH / CAM.ppu) / (2 * Math.tan(rad(CAM.fovDeg) / 2));
  const upOff = CAM.groundPxBelowCentre / CAM.ppu;
  const target = [camX, upOff * cp, -upOff * sp];
  const pos = [target[0], target[1] + dist * sp, target[2] + dist * cp];
  const fwd = norm(sub(target, pos)), right = norm(cross(fwd, [0, 1, 0])), up = cross(right, fwd);
  return { pos, fwd, right, up, sp, cp };
}

/** World point -> screen pixel (1920x1080 by default), top-left origin. */
export function project(cam, p, w = CAM.sceneW * CAM.scale, h = CAM.sceneH * CAM.scale) {
  const r = sub(p, cam.pos);
  const z = dot(r, cam.fwd), f = 1 / Math.tan(rad(CAM.fovDeg) / 2);
  return [((dot(r, cam.right) * f) / z / (w / h) * 0.5 + 0.5) * w, (1 - ((dot(r, cam.up) * f) / z * 0.5 + 0.5)) * h];
}

/** The hero atlas: manifest, colour and normal sheets (decoded RGBA). */
export function loadAtlas(name = 'hero') {
  const dir = join(ROOT, 'games/nr/assets/atlases');
  const manifest = JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8'));
  return { manifest, colour: readImage(join(dir, `${name}.png`)), normal: readImage(join(dir, `${name}-n.png`)) };
}

/** World position of texel (u, v) of a hero's plane for the atlas cell geometry; the hero stands at (x, 0, z). `flip` is a
 * hero facing left: the plane is mirrored about its centre, which the pivot offset mirrors with. */
export function texelWorld(atlas, cam, hero, u, v, flip = false) {
  const { cell } = atlas.manifest, pv = atlas.manifest.frames[0].pivot, s = flip ? -1 : 1;
  const rightOff = (cell.width / 2 - pv.x) / CAM.ppu, upOff = (pv.y - cell.height / 2) / CAM.ppu;
  const centre = [hero.x + rightOff * s, upOff * cam.cp, hero.z - upOff * cam.sp];
  const lx = (u + 0.5 - cell.width / 2) / CAM.ppu * s, ly = (cell.height / 2 - (v + 0.5)) / CAM.ppu;
  return [centre[0] + lx, centre[1] + ly * cam.cp, centre[2] - ly * cam.sp];
}

export const lum = (img, x, y) => {
  const o = (y * img.w + x) * 4;
  return 0.2126 * img.rgba[o] + 0.7152 * img.rgba[o + 1] + 0.0722 * img.rgba[o + 2];
};

/** Opaque texels of an atlas frame with their decoded normals: [{u, v, nx, ny}] */
export function frameTexels(atlas, frameIndex) {
  const f = atlas.manifest.frames[frameIndex];
  const out = [];
  const { colour, normal } = atlas;
  for (let v = 0; v < f.rect.h; v++) for (let u = 0; u < f.rect.w; u++) {
    const o = ((f.rect.y + v) * colour.w + f.rect.x + u) * 4;
    if (colour.rgba[o + 3] !== 255) continue;
    out.push({ u, v, nx: normal.rgba[o] / 127.5 - 1, ny: normal.rgba[o + 1] / 127.5 - 1 });
  }
  return out;
}

/** Path stem of a capture: the native binary's set is <dir>/<name>-f<N>, the cart's the same under <dir>/cart/. */
export const capBase = (dir, host, name, frames) => join(dir, host === 'cart' ? 'cart' : '.', `${name}-f${frames}`);
