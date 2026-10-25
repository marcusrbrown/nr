// Generates nr's five sound effects deterministically, as 16-bit mono 22050 Hz PCM WAV files next to this script:
//
//   hit.wav      a thud: a 140 -> 60 Hz sine falling under a short burst of noise
//   grab.wav     a rising two-step blip (grab and throw)
//   special.wav  a 0.4 s sweep from 220 to 1320 Hz with a vibrato tail
//   hurt.wav     a falling square-ish buzz, 0.24 s
//   confirm.wav  two sine pings, a fifth apart (join, begin, pick)
//
//   node games/nr/assets/audio/gen-audio.mjs            write the files
//   node games/nr/assets/audio/gen-audio.mjs --check    exit 1 when a file differs from what the script writes
//
// Only integer PCM and one fixed linear-congruential noise source are used, and the sine is Math.sin of an exact phase
// rounded to integers, so the bytes depend on this script alone (they are compared by --check and listed with their
// sha256 in ../LICENSE-NOTICES.md).
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const RATE = 22050;

function noise() {
  let x = 0x4e52; // "NR"
  return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return (x >>> 8) / 8388608 - 1; };
}

/** samples (floats -1..1) from fn(t seconds, i), for `seconds` */
const render = (seconds, fn) => Float64Array.from({ length: Math.round(seconds * RATE) }, (_, i) => fn(i / RATE, i));
const env = (t, attack, length) => (t < attack ? t / attack : Math.max(0, 1 - (t - attack) / (length - attack)));

function wav(samples) {
  const pcm = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => pcm.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(v * 30000))), i * 2));
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

export function sounds() {
  const out = {};
  let n = noise();
  let phase = 0;
  out['hit.wav'] = render(0.14, (t) => {
    phase += 2 * Math.PI * (140 - 80 * (t / 0.14)) / RATE;
    return env(t, 0.004, 0.14) * (0.75 * Math.sin(phase) + 0.45 * n() * env(t, 0.001, 0.05));
  });
  phase = 0;
  out['grab.wav'] = render(0.16, (t) => {
    phase += 2 * Math.PI * (t < 0.08 ? 520 : 780) / RATE;
    return 0.6 * Math.sin(phase) * env(t % 0.08, 0.004, 0.08);
  });
  phase = 0;
  out['special.wav'] = render(0.4, (t) => {
    phase += 2 * Math.PI * (220 + 1100 * (t / 0.4) ** 1.5 + 30 * Math.sin(2 * Math.PI * 14 * t)) / RATE;
    return 0.6 * env(t, 0.02, 0.4) * Math.sign(Math.sin(phase)) * 0.5 + 0.35 * Math.sin(phase) * env(t, 0.02, 0.4);
  });
  phase = 0;
  n = noise();
  out['hurt.wav'] = render(0.24, (t) => {
    phase += 2 * Math.PI * (330 - 190 * (t / 0.24)) / RATE;
    return 0.5 * env(t, 0.004, 0.24) * (Math.sign(Math.sin(phase)) * 0.6 + 0.25 * n());
  });
  out['confirm.wav'] = render(0.2, (t) => {
    const f = t < 0.09 ? 660 : 990;
    return 0.55 * Math.sin(2 * Math.PI * f * t) * env(t < 0.09 ? t : t - 0.09, 0.003, t < 0.09 ? 0.09 : 0.11);
  });
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, wav(v)]));
}

const files = sounds();
if (process.argv.includes('--check')) {
  const bad = Object.entries(files).filter(([name, bytes]) => { try { return !readFileSync(join(DIR, name)).equals(bytes); } catch { return true; } });
  console.log(bad.length ? `differs: ${bad.map(([n]) => n).join(', ')}` : `${Object.keys(files).length} files match the script`);
  process.exit(bad.length ? 1 : 0);
}
for (const [name, bytes] of Object.entries(files)) {
  writeFileSync(join(DIR, name), bytes);
  console.log(`${name}: ${bytes.length} bytes sha256 ${createHash('sha256').update(bytes).digest('hex')}`);
}
