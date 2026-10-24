// Strict predicates of the cross-host gates, and the tool gate that applies them to the artifacts the stock
// entries of tests/gates.json (those with "strict": true) wrote to out/gate/ in the same gate.mjs run.
//
// The engine's stock comparison (deps/cartwheel-engine/tests/gate.mjs) lets these through:
//   - a whitelisted field that is missing or not finite on both sides, or non-finite only on the reference
//   - two 0x0 frames (the share of differing pixels is 0/0, which compares as "not over the bound")
//   - a nonzero cw.three.missing count with no state text
// Here each is a rejection. State comparison is exact: no tolerance applies to any whitelisted field.
//
//   node games/spike/tests/gate-strict.mjs        (CW_PROJECT_ROOT defaults to this repository)
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { diffImages, readImage } from '../../../deps/cartwheel-engine/tools/lib/png.mjs';

export const FLOOR_GT16 = 0.0005;

/** the state file as an object, or a rejection string */
export function readState(path) {
  try { return { state: JSON.parse(readFileSync(path, 'utf8')) }; } catch (e) { return { reject: `${path}: not readable state JSON (${e.message})` }; }
}

/** flat list of a debug value (scalar or array), or null when it is missing or not all finite numbers */
function numbers(v) {
  if (v === undefined) return null;
  const xs = [].concat(v);
  return xs.length > 0 && xs.every((n) => typeof n === 'number' && Number.isFinite(n)) ? xs : null;
}

/**
 * Whitelisted state of `got` against `ref`, exact. `rejected`: a field missing or not finite on either side (the
 * comparison is not made). `diverged`: [{ field, index, ref, got }] in the order of `fields`, the first being the
 * first divergent whitelisted field.
 */
export function stateProblems(ref, got, fields) {
  const rejected = [], diverged = [];
  for (const f of fields) {
    const a = numbers(ref[f]), b = numbers(got[f]);
    if (!a) rejected.push(`${f}: reference value missing or not finite`);
    if (!b) rejected.push(`${f}: value missing or not finite`);
    if (!a || !b) continue;
    if (a.length !== b.length) { diverged.push({ field: f, index: -1, ref: `length ${a.length}`, got: `length ${b.length}` }); continue; }
    const i = a.findIndex((x, j) => x !== b[j]);
    if (i >= 0) diverged.push({ field: f, index: i, ref: a[i], got: b[i] });
  }
  return { rejected, diverged };
}

/** gt16 of `got` against `ref` (decoded images), with 0x0 and size mismatches rejected before any metric */
export function imageProblems(ref, got, maxGt16) {
  const out = { rejected: [], over: null, gt16: null, max: null };
  for (const [n, im] of [['reference frame', ref], ['host frame', got]])
    if (!(im.w > 0 && im.h > 0)) out.rejected.push(`${n} is ${im.w}x${im.h}`);
  if (out.rejected.length) return out;
  const d = diffImages(ref, got);
  if (!d.comparable) { out.rejected.push(d.reason); return out; }
  if (!Number.isFinite(d.gt16)) { out.rejected.push('gt16 is not finite'); return out; }
  out.gt16 = d.gt16; out.max = d.max;
  if (d.gt16 > maxGt16) out.over = `${(d.gt16 * 100).toFixed(4)}% of pixels differ by >16 (bound ${(maxGt16 * 100).toFixed(4)}%)`;
  return out;
}

export function readFrame(path) {
  try { return { img: readImage(path) }; } catch (e) { return { reject: `${path}: not a readable frame (${e.message})` }; }
}

/** the program states a run drew without a program (cw.three.missing_states: a byte array, hex or text) */
export function missingStates(st) {
  const v = st['cw.three.missing_states'];
  if (!v) return [];
  const bytes = Array.isArray(v) ? v : typeof v === 'string' && /^[0-9a-f]*$/i.test(v) ? v.match(/../g) || [] : null;
  const text = bytes ? String.fromCharCode(...bytes.map((b) => (typeof b === 'number' ? b : parseInt(b, 16))).filter((b) => b)) : String(v);
  return text.split('\n').map((l) => l.trim()).filter(Boolean);
}

/** cumulative cw.three.missing must be present, finite and 0 with no state text */
export function missingProblems(st) {
  const out = [];
  const m = numbers(st['cw.three.missing']);
  if (!m) out.push('cw.three.missing is missing or not finite');
  else if (m[0] !== 0) out.push(`cw.three.missing = ${m[0]}`);
  const names = missingStates(st);
  if (names.length) out.push(`program states without a table row: ${names.join(', ')}`);
  return out;
}

/** every predicate of the gate on one host's artifacts: { image, state, missing } each a list of problem strings */
export function verdict({ refShot, refState, shot, state, fields, maxGt16 }) {
  const v = { image: [], state: [], missing: [] };
  const rs = refState, gs = state;
  const rf = readFrame(refShot), gf = readFrame(shot);
  if (rf.reject) v.image.push(rf.reject);
  if (gf.reject) v.image.push(gf.reject);
  if (rf.img && gf.img) {
    const p = imageProblems(rf.img, gf.img, maxGt16);
    v.image.push(...p.rejected, ...(p.over ? [p.over] : []));
    v.gt16 = p.gt16;
  }
  const sp = stateProblems(rs, gs, fields);
  v.state.push(...sp.rejected.map((r) => `rejected: ${r}`), ...sp.diverged.map((d) => `${d.field}[${d.index}]: ${d.ref} vs ${d.got}`));
  v.firstDivergent = sp.diverged[0]?.field ?? null;
  v.missing.push(...missingProblems(gs));
  return v;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const PROJ = process.env.CW_PROJECT_ROOT ? resolve(process.env.CW_PROJECT_ROOT) : REPO;
  const OUT = join(PROJ, 'out', 'gate');
  const gates = JSON.parse(readFileSync(join(PROJ, 'tests', 'gates.json'), 'utf8')).filter((g) => g.strict);
  let failed = 0;
  for (const g of gates) {
    const host = g.hosts.find((h) => h !== 'native');
    const p = (h, ext) => join(OUT, `${g.name}.${h}.${ext}`);
    const problems = [];
    const need = [p('native', 'png'), p('native', 'json'), p(host, 'png'), p(host, 'json')];
    const absent = need.filter((f) => !existsSync(f));
    if (absent.length) problems.push(`artifacts missing (run the strict entries first, in the same gate.mjs invocation): ${absent.join(', ')}`);
    else {
      const rs = readState(p('native', 'json')), gs = readState(p(host, 'json'));
      if (rs.reject || gs.reject) problems.push(rs.reject || gs.reject);
      else {
        const v = verdict({ refShot: p('native', 'png'), refState: rs.state, shot: p(host, 'png'), state: gs.state, fields: g.fields, maxGt16: g.maxGt16 });
        problems.push(...v.image.map((x) => `image: ${x}`), ...v.state.map((x) => `state: ${x}`), ...v.missing.map((x) => `missing: ${x}`));
        for (const m of missingProblems(rs.state)) problems.push(`native missing: ${m}`);
      }
    }
    if (problems.length) { failed++; console.log(`FAIL ${g.name}\n  ${problems.join('\n  ')}`); } else console.log(`ok   ${g.name} (native vs ${host})`);
  }
  process.exit(failed ? 1 : 0);
}
