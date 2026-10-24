// Copies of a cart with one deliberate defect, for the controls of the cart checks. The input cart is never modified.
//
//   node games/spike/tests/cart-tools.mjs strip-export <in.wasc> <out.wasc> <export-name>   remove one export from cart.wasm
//   node games/spike/tests/cart-tools.mjs tamper-asset <in.wasc> <out.wasc> <asset-path>    flip one byte of assets/<asset-path>
//   node games/spike/tests/cart-tools.mjs set-manifest <in.wasc> <out.wasc> <key=json>      set one key of manifest.json (e.g. width=640)
//   node games/spike/tests/cart-tools.mjs exports <in.wasc>                                 list cart.wasm's exports
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { unzipSync, zipSync } = createRequire(join(ROOT, 'deps/cartwheel-engine/deps/wasmcart/package.json'))('fflate');

const uleb = (n) => { const o = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; o.push(b); } while (n); return Buffer.from(o); };
function readUleb(buf, o) { let r = 0, s = 0, b; do { b = buf[o++]; r |= (b & 0x7f) << s; s += 7; } while (b & 0x80); return [r >>> 0, o]; }

// [{ name, kind, index, start, end }] for the export section and the section's own byte range
function exportSection(wasm) {
  let o = 8;
  while (o < wasm.length) {
    const id = wasm[o], sizeAt = o + 1;
    const [size, body] = readUleb(wasm, sizeAt);
    if (id === 7) {
      let [count, p] = readUleb(wasm, body);
      const entries = [];
      for (let i = 0; i < count; i++) {
        const start = p;
        const [len, q] = readUleb(wasm, p);
        const name = wasm.toString('utf8', q, q + len);
        const kind = wasm[q + len];
        const [index, end] = readUleb(wasm, q + len + 1);
        entries.push({ name, kind, index, start, end });
        p = end;
      }
      return { entries, sectionStart: o, bodyEnd: body + size };
    }
    o = body + size;
  }
  throw new Error('no export section');
}

function stripExport(wasm, name) {
  const sec = exportSection(wasm);
  const hit = sec.entries.find((e) => e.name === name);
  if (!hit) throw new Error(`no export named ${name}`);
  const kept = sec.entries.filter((e) => e !== hit);
  const body = Buffer.concat([uleb(kept.length), ...kept.map((e) => wasm.subarray(e.start, e.end))]);
  return Buffer.concat([wasm.subarray(0, sec.sectionStart), Buffer.from([7]), uleb(body.length), body, wasm.subarray(sec.bodyEnd)]);
}

const [cmd, input, output, target] = process.argv.slice(2);
if (!cmd || !input) { console.error('usage: cart-tools.mjs strip-export|tamper-asset|exports <in.wasc> [<out.wasc> <name>]'); process.exit(2); }
const files = unzipSync(new Uint8Array(readFileSync(input)));
if (cmd === 'exports') {
  for (const e of exportSection(Buffer.from(files['cart.wasm'])).entries) console.log(`${['func', 'table', 'memory', 'global'][e.kind] ?? e.kind}\t${e.name}`);
} else if (cmd === 'strip-export') {
  files['cart.wasm'] = new Uint8Array(stripExport(Buffer.from(files['cart.wasm']), target));
  writeFileSync(output, zipSync(files));
  console.log(`wrote ${output} without export ${target}`);
} else if (cmd === 'tamper-asset') {
  const k = `assets/${target}`;
  if (!files[k]) throw new Error(`no ${k} in ${input}`);
  files[k] = Uint8Array.from(files[k]);
  files[k][files[k].length - 1] ^= 1;
  writeFileSync(output, zipSync(files));
  console.log(`wrote ${output} with one byte of ${k} flipped`);
} else if (cmd === 'set-manifest') {
  const [key, value] = target.split(/=(.*)/s);
  const manifest = JSON.parse(Buffer.from(files['manifest.json']).toString('utf8'));
  manifest[key] = JSON.parse(value);
  files['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest));
  writeFileSync(output, zipSync(files));
  console.log(`wrote ${output} with manifest ${key}=${value}`);
} else { console.error(`unknown command ${cmd}`); process.exit(2); }
