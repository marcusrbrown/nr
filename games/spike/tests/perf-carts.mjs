// Cart-host frame-time measurement for the spike carts, recorded and never gated (docs/evidence/shipping-path-spike).
//
//   CW_TEST_GPU=desktop node games/spike/tests/perf-carts.mjs --host romdev|chromium --cart build/cart/carts/spike_stress.wasc \
//       [--runs 3] [--label NAME] [--out out/unit6/perf]
//
// 120 warm-up frames, then 600 measured frames, neutral input, deterministic cart clock (the cart's own clock is
// virtual and is never read for timing). Each measured frame is timed from outside on the host's real clock:
//   romdev    one `frame{op:step, frames:1}` HTTP call per frame (call overhead included); the call overhead is
//             measured separately as 200 `wasm{op:info}` calls, which run no frame.
//   chromium  `host.runFrame()` in the page (wasm, every GL import it makes, the host's own work).
// A cart built with SPIKE_PERF reads a pixel back after every frame, so its frames end when the GPU work does; a
// default cart does not wait, so its numbers are submission cost. The readback overhead is the difference of the two.
// Memory: the WASM linear-memory size after the warm-up and at the end (romdev: the heap size the host reports for an
// out-of-range read; chromium: host.memory.buffer.byteLength), a size and not a high-water mark.
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const HOST = opt('host', null);
const CART = resolve(ROOT, opt('cart', 'build/cart/carts/spike_stress.wasc'));
const RUNS = +opt('runs', 3);
const LABEL = opt('label', `${HOST}-${basename(CART, '.wasc')}`);
const OUT = resolve(ROOT, opt('out', 'out/unit6/perf'));
const WARMUP = 120, MEASURED = 600;
if (!['romdev', 'chromium'].includes(HOST)) { console.error('perf-carts: --host romdev|chromium'); process.exit(2); }
if (!existsSync(CART)) { console.error(`perf-carts: no ${CART}`); process.exit(2); }
mkdirSync(OUT, { recursive: true });

const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.max(0, Math.ceil((p / 100) * s.length) - 1)]; };
const stats = (a) => ({ n: a.length, p50: pct(a, 50), p99: pct(a, 99), max: Math.max(...a), mean: a.reduce((x, y) => x + y, 0) / a.length });

// ── romdev ────────────────────────────────────────────────────────────
async function romdev(session, tool, body) {
  const res = await fetch(`http://localhost:7331/tool/${tool}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-romdev-session': session }, body: JSON.stringify(body) });
  const text = await res.text();
  let j;
  try { j = JSON.parse(text); } catch { j = { raw: text }; }
  if (!res.ok || j.isError || j.error) { const e = new Error(`romdev ${tool}: ${res.status} ${text.slice(0, 400)}`); e.body = j; throw e; }
  return j;
}
async function heapBytes(session) {
  try { await romdev(session, 'wasm', { op: 'read', offset: 4_000_000_000, length: 1 }); } catch (e) {
    const m = /past the (\d+)-byte WASM heap/.exec(e.body?.error ?? ''); if (m) return +m[1];
  }
  return null;
}
async function runRomdev(n) {
  const session = `nr-unit6-perf-${LABEL}-${n}`;
  await romdev(session, 'loadMedia', { platform: 'wasmcart', path: CART, deterministicSeed: 1, deterministicStepMs: 16.6667 });
  await romdev(session, 'frame', { op: 'step', frames: WARMUP - 1 }); // the load ran frame 1
  const heapWarm = await heapBytes(session);
  const frameMs = [];
  for (let k = 0; k < MEASURED; k++) {
    const t0 = performance.now();
    await romdev(session, 'frame', { op: 'step', frames: 1 });
    frameMs.push(performance.now() - t0);
  }
  const heapEnd = await heapBytes(session);
  const callMs = [];
  for (let k = 0; k < 200; k++) {
    const t0 = performance.now();
    await romdev(session, 'wasm', { op: 'info' });
    callMs.push(performance.now() - t0);
  }
  const st = await romdev(session, 'wasm', { op: 'debugState' });
  const ticks = (st.fields.find((f) => f.name === 'spike.ticks') || {}).value;
  await romdev(session, 'host', { op: 'shutdown' }).catch(() => {});
  return { run: n, frame_ms: stats(frameMs), call_overhead_ms: stats(callMs), heapBytes: { afterWarmup: heapWarm, end: heapEnd }, ticksFinal: ticks, series: frameMs };
}

// ── chromium ──────────────────────────────────────────────────────────
const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.wasc': 'application/octet-stream' };
async function runChromium() {
  const WC = join(ROOT, 'deps/cartwheel-engine/deps/wasmcart');
  const page = `<!doctype html><html><body><canvas id=c></canvas>
<script type=importmap>{"imports":{"fflate":"/wc/node_modules/fflate/esm/browser.js"}}</script>
<script type=module>
import { CartHostWeb } from '/wc/src/CartHostWeb.js';
window.run = async (warm, measured) => {
  const host = new CartHostWeb();
  const canvas = document.getElementById('c');
  let lost = -1, k = 0;
  canvas.addEventListener('webglcontextlost', () => { lost = k; });
  await host.load('/cart.wasc', { glBackend: () => canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: false }) });
  const info = host.getInfo();
  canvas.width = info.width; canvas.height = info.height;
  const step = 1000 / 60;
  host._writeTime = ((orig) => function () { orig.call(this, k * step, step, k); })(host._writeTime);
  const pads = [{ connected: true, buttons: 0 }, { connected: false }, { connected: false }, { connected: false }];
  const mem = () => (host.memory ? host.memory.buffer : host.instance.exports.memory.buffer).byteLength;
  const ms = [];
  let memWarm = 0;
  for (k = 0; k < warm + measured; k++) {
    if (k === warm) memWarm = mem();
    const t0 = performance.now();
    await host.runFrame(pads);
    const t1 = performance.now();
    if (k >= warm) ms.push(t1 - t0);
    await new Promise((r) => setTimeout(r, 0));
  }
  const gl = host.getGlContext();
  const e = gl.getExtension('WEBGL_debug_renderer_info');
  const ex = host.instance.exports;
  const dv = new DataView((host.memory ? host.memory.buffer : ex.memory.buffer));
  let ticks = null;
  const str = (q) => { let s = ''; for (let b; (b = dv.getUint8(q)); q++) s += String.fromCharCode(b); return s; };
  for (let p = ex.wc_debug_state(); ; p += 16) {
    const nm = dv.getUint32(p, true); if (!nm) break;
    if (str(nm) === 'spike.ticks') ticks = dv.getInt32(dv.getUint32(p + 4, true), true);
  }
  return { ms, memWarm, memEnd: mem(), lost, ticks, renderer: e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
};
window.ready = true;
</script></body></html>`;
  const server = createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    if (url === '/') { res.setHeader('Content-Type', 'text/html'); res.end(page); return; }
    const file = url === '/cart.wasc' ? CART : url.startsWith('/wc/') ? join(WC, url.slice(4)) : null;
    if (!file || !existsSync(file)) { res.statusCode = 404; res.end(); return; }
    res.setHeader('Content-Type', MIME[extname(file)] || 'application/octet-stream');
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { chromium } = await import(join(WC, 'node_modules', 'playwright', 'index.mjs'));
  const { launchChromium } = await import(join(ROOT, 'deps/cartwheel-engine/tools/lib/chromium.mjs'));
  const { browser, verify } = await launchChromium(chromium, OUT);
  const results = [];
  try {
    for (let n = 1; n <= RUNS; n++) {
      const pg = await browser.newPage({ viewport: { width: 1960, height: 1120 } });
      await pg.goto(`http://127.0.0.1:${server.address().port}/`);
      await pg.waitForFunction('window.ready === true');
      await verify(pg);
      const r = await pg.evaluate(([w, m]) => window.run(w, m), [WARMUP, MEASURED]);
      await pg.close();
      if (r.lost >= 0) throw new Error(`WebGL context lost at frame ${r.lost}`);
      results.push({ run: n, frame_ms: stats(r.ms), heapBytes: { afterWarmup: r.memWarm, end: r.memEnd }, ticksFinal: r.ticks, renderer: r.renderer, series: r.ms });
    }
  } finally { await browser.close(); server.close(); }
  return results;
}

const runs = [];
if (HOST === 'romdev') for (let n = 1; n <= RUNS; n++) runs.push(await runRomdev(n));
else runs.push(...(await runChromium()));
for (const r of runs) {
  const f = r.frame_ms;
  console.log(`${LABEL}-${r.run}: p50 ${f.p50.toFixed(2)} p99 ${f.p99.toFixed(2)} max ${f.max.toFixed(2)} ms` +
    (r.call_overhead_ms ? ` | call overhead p50 ${r.call_overhead_ms.p50.toFixed(2)} p99 ${r.call_overhead_ms.p99.toFixed(2)}` : '') +
    ` | heap ${r.heapBytes.afterWarmup}/${r.heapBytes.end} | ticks ${r.ticksFinal}${r.renderer ? ` | ${r.renderer}` : ''}`);
}
const summary = { label: LABEL, host: HOST, cart: CART, runs: runs.length,
  p50_median: pct(runs.map((r) => r.frame_ms.p50), 50), p99_median: pct(runs.map((r) => r.frame_ms.p99), 50),
  p99_worst: Math.max(...runs.map((r) => r.frame_ms.p99)), max_worst: Math.max(...runs.map((r) => r.frame_ms.max)),
  call_overhead_p50_median: runs[0].call_overhead_ms ? pct(runs.map((r) => r.call_overhead_ms.p50), 50) : null,
  heapBytes: runs[0].heapBytes, ticksFinal: runs.map((r) => r.ticksFinal) };
writeFileSync(join(OUT, `${LABEL}.json`), JSON.stringify({ summary, runs }) + '\n');
console.log(JSON.stringify(summary));
