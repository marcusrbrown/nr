// Cart-host frame-time and memory measurement of the nr carts, recorded and never gated.
//
//   CW_TEST_GPU=desktop node games/nr/tests/perf-carts.mjs --host romdev|chromium --gpu gl|webgpu --cart build/cart-wgpu/carts/nr_stress.wasc
//       [--runs 3] [--frames 720] [--input games/nr/tests/input-2p-full.json (chromium only)] [--label NAME] [--out out/unit8/perf]
//
// The first 120 frames are warm-up, the rest measured (600 for the default 720), deterministic cart clock (the cart's own clock
// is virtual and is never read for timing). Each measured frame is timed from outside on the host's real clock:
//   romdev    one `frame{op:step, frames:1}` HTTP call per frame (call overhead included); the call overhead is measured
//             separately as 200 `wasm{op:info}` calls, which run no frame
//   chromium  `host.runFrame()` in the page (wasm, every GL or WebGPU import it makes, the host's own work)
// A WebGPU frame ends when its commands are submitted, not when the GPU is done; on chromium --gpu webgpu a second series
// (`done_ms`) times the frame plus `host.readGpuFrame()`, which waits for the GPU and reads the 1080p frame back, so it includes
// the readback.
// Memory: the WASM linear-memory size (romdev reports it for an out-of-range read; chromium: host.memory.buffer.byteLength; both
// are the memory the host allocated, not what the cart touched) and, on chromium, the memory the cart's data fills: the pages
// (4 KiB) of linear memory holding any non-zero byte and the end of the highest non-zero byte, at the title, after the warm-up
// and at the end. Linear memory never shrinks and a page the cart wrote stays non-zero unless it wrote zeros over it, so the
// end value is a lower bound of the touched high-water mark. The title sample is taken when the cart is loaded, before its first
// frame runs init (which decodes the atlas sheets), so the after-warm-up and end samples are the ones that hold the game's data. `stats` through the debug channel reports the engine's own tags (mem_total, mem_peak) and is
// recorded on romdev.
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { romdevCall } from './hosts-lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const HOST = opt('host', null), GPU = opt('gpu', 'gl');
const CART = resolve(ROOT, opt('cart', GPU === 'gl' ? 'build/cart/carts/nr_stress.wasc' : 'build/cart-wgpu/carts/nr_stress.wasc'));
const RUNS = +opt('runs', 3);
const WARMUP = 120, FRAMES = +opt('frames', 720), MEASURED = FRAMES - WARMUP;
const LABEL = opt('label', `${HOST}-${GPU}-${basename(CART, '.wasc')}`);
const OUT = resolve(ROOT, opt('out', 'out/unit8/perf'));
const INPUT = opt('input', null);
if (!['romdev', 'chromium'].includes(HOST) || !['gl', 'webgpu'].includes(GPU)) { console.error('perf-carts: --host romdev|chromium --gpu gl|webgpu'); process.exit(2); }
if (!existsSync(CART)) { console.error(`perf-carts: no ${CART}`); process.exit(2); }
if (INPUT && HOST !== 'chromium') { console.error('perf-carts: --input is for --host chromium'); process.exit(2); }
mkdirSync(OUT, { recursive: true });

const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.max(0, Math.ceil((p / 100) * s.length) - 1)]; };
const stats = (a) => ({ n: a.length, p50: pct(a, 50), p99: pct(a, 99), max: Math.max(...a), mean: a.reduce((x, y) => x + y, 0) / a.length });

// ── romdev ────────────────────────────────────────────────────────────
async function heapBytes(session) {
  try { await romdevCall(session, 'wasm', { op: 'read', offset: 4_000_000_000, length: 1 }); } catch (e) {
    const m = /past the (\d+)-byte WASM heap/.exec(e.message); if (m) return +m[1];
  }
  return null;
}
async function runRomdev(n) {
  const session = `nr-unit8-perf-${LABEL}-${n}`;
  const loaded = await romdevCall(session, 'loadMedia', { platform: 'wasmcart', path: CART, wgpu: GPU === 'webgpu', deterministicSeed: 1, deterministicStepMs: 16.6667 });
  if (loaded.gpu !== (GPU === 'webgpu' ? 'webgpu' : 'gl')) throw new Error(`loadMedia reported gpu ${loaded.gpu}`);
  const heapTitle = await heapBytes(session);
  await romdevCall(session, 'frame', { op: 'step', frames: WARMUP - 1 }); // the load ran frame 1
  const heapWarm = await heapBytes(session);
  const frameMs = [];
  for (let k = 0; k < MEASURED; k++) {
    const t0 = performance.now();
    await romdevCall(session, 'frame', { op: 'step', frames: 1 });
    frameMs.push(performance.now() - t0);
  }
  const heapEnd = await heapBytes(session);
  const callMs = [];
  for (let k = 0; k < 200; k++) {
    const t0 = performance.now();
    await romdevCall(session, 'wasm', { op: 'info' });
    callMs.push(performance.now() - t0);
  }
  const engine = (await romdevCall(session, 'wasm', { op: 'command', text: 'stats' })).reply;
  const st = await romdevCall(session, 'wasm', { op: 'debugState' });
  const ticks = (st.fields.find((f) => f.name === 'nr.ticks') || {}).value;
  await romdevCall(session, 'host', { op: 'shutdown' }).catch(() => {});
  return { run: n, frame_ms: stats(frameMs), call_overhead_ms: stats(callMs), heapBytes: { atTitle: heapTitle, afterWarmup: heapWarm, end: heapEnd }, engineMem: { mem_total: engine.mem_total, mem_peak: engine.mem_peak, mem: engine.mem }, ticksFinal: ticks, adapter: loaded.gpuAdapter, series: frameMs };
}

// ── chromium ──────────────────────────────────────────────────────────
const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.wasc': 'application/octet-stream', '.wasm': 'application/wasm' };
const WC_BITS = { south: 0, east: 1, west: 2, north: 3, l: 4, r: 5, start: 6, back: 7, up: 8, down: 9, left: 10, right: 11 };
const mask = (names) => (names || []).reduce((m, nme) => m | (1 << WC_BITS[nme]), 0);
async function runChromium() {
  if (GPU === 'webgpu') { process.env.CW_CHROMIUM_GPU ||= 'none'; process.env.CW_CHROMIUM_ARGS = [process.env.CW_CHROMIUM_ARGS || '', '--enable-unsafe-webgpu'].join(' ').trim(); }
  const WC = join(ROOT, 'deps/cartwheel-engine/deps/wasmcart');
  const script = (INPUT ? JSON.parse(readFileSync(resolve(ROOT, INPUT), 'utf8')) : []).map((s) => ({ frame: s.frame, pad1: mask(s.buttons), pad2: s.pad2 ? mask(s.pad2.buttons) : null }));
  const page = `<!doctype html><html><body><canvas id=c></canvas>
<script type=importmap>{"imports":{"fflate":"/wc/node_modules/fflate/esm/browser.js"}}</script>
<script type=module>
import { CartHostWeb } from '/wc/src/CartHostWeb.js';
window.run = async (cfg) => {
  const host = new CartHostWeb();
  const canvas = document.getElementById('c');
  let lost = -1, k = 0;
  canvas.addEventListener('webglcontextlost', () => { lost = k; });
  await host.load('/cart.wasc', { glBackend: () => canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true }),
    ...(cfg.gpu === 'webgpu' ? { adapterOptions: { powerPreference: 'high-performance' } } : { wgpu: false }) });
  if (cfg.gpu === 'webgpu' && !host.usesWgpu) throw new Error('the cart did not run on WebGPU');
  const info = host.getInfo();
  canvas.width = info.width; canvas.height = info.height;
  const step = 1000 / 60;
  host._writeTime = ((orig) => function () { orig.call(this, k * step, step, k); })(host._writeTime);
  const pads = [{ connected: true, buttons: 0 }, { connected: false }, { connected: false }, { connected: false }];
  const mem = () => (host.memory ? host.memory.buffer : host.instance.exports.memory.buffer).byteLength;
  const fill = () => {
    const u = new Uint32Array(host.memory ? host.memory.buffer : host.instance.exports.memory.buffer);
    let pages = 0, top = 0;
    for (let q = 0; q < u.length; q += 1024) {
      let any = false;
      for (let i = q; i < q + 1024; i++) if (u[i]) { any = true; if (i >= top) top = i + 1; }
      if (any) pages++;
    }
    return { pages, bytes: pages * 4096, highestNonZeroBytes: top * 4 };
  };
  const memTitle = mem();
  const fillTitle = fill();
  const ms = [], done = [];
  let memWarm = 0, fillWarm = null, si = 0;
  for (k = 0; k < cfg.warm + cfg.measured; k++) {
    if (k === cfg.warm) { memWarm = mem(); fillWarm = fill(); }
    while (si < cfg.script.length && cfg.script[si].frame - 1 <= k) {
      const e = cfg.script[si++];
      pads[0] = { connected: true, buttons: e.pad1 };
      pads[1] = e.pad2 === null ? { connected: false } : { connected: true, buttons: e.pad2 };
    }
    const t0 = performance.now();
    await host.runFrame(pads);
    const t1 = performance.now();
    if (cfg.gpu === 'webgpu' && k >= cfg.warm) { await host.readGpuFrame(); done.push(performance.now() - t0); }
    if (k >= cfg.warm) ms.push(t1 - t0);
    await new Promise((r) => setTimeout(r, 0));
  }
  const ex = host.instance.exports;
  const dv = new DataView((host.memory ? host.memory.buffer : ex.memory.buffer));
  let ticks = null;
  const str = (q) => { let s = ''; for (let b; (b = dv.getUint8(q)); q++) s += String.fromCharCode(b); return s; };
  for (let p = ex.wc_debug_state(); ; p += 16) {
    const nm = dv.getUint32(p, true); if (!nm) break;
    if (str(nm) === 'nr.ticks') ticks = dv.getInt32(dv.getUint32(p + 4, true), true);
  }
  let renderer = null;
  if (cfg.gpu === 'gl') { const gl = host.getGlContext(); const e = gl.getExtension('WEBGL_debug_renderer_info'); renderer = e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); }
  else renderer = JSON.stringify(host.getGpuAdapterInfo ? host.getGpuAdapterInfo() : null);
  return { ms, done, memTitle, memWarm, memEnd: mem(), fill: { atTitle: fillTitle, afterWarmup: fillWarm, end: fill() }, lost, ticks, renderer };
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
  const { browser, verify } = await launchChromium(chromium, OUT, []);
  const results = [];
  try {
    for (let n = 1; n <= RUNS; n++) {
      const pg = await browser.newPage({ viewport: { width: 1960, height: 1120 } });
      await pg.goto(`http://127.0.0.1:${server.address().port}/`);
      await pg.waitForFunction('window.ready === true');
      if (GPU === 'gl') await verify(pg);
      const r = await pg.evaluate((c) => window.run(c), { gpu: GPU, warm: WARMUP, measured: MEASURED, script });
      await pg.close();
      if (r.lost >= 0) throw new Error(`WebGL context lost at frame ${r.lost}`);
      results.push({ run: n, frame_ms: stats(r.ms), done_ms: r.done.length ? stats(r.done) : null, heapBytes: { atTitle: r.memTitle, afterWarmup: r.memWarm, end: r.memEnd }, filled: r.fill, ticksFinal: r.ticks, renderer: r.renderer, series: r.ms });
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
    (r.done_ms ? ` | with GPU wait and readback p50 ${r.done_ms.p50.toFixed(2)} p99 ${r.done_ms.p99.toFixed(2)}` : '') +
    (r.call_overhead_ms ? ` | call overhead p50 ${r.call_overhead_ms.p50.toFixed(2)} p99 ${r.call_overhead_ms.p99.toFixed(2)}` : '') +
    ` | heap ${r.heapBytes.atTitle}/${r.heapBytes.afterWarmup}/${r.heapBytes.end}${r.filled ? ` filled ${(r.filled.end.bytes / 1048576).toFixed(1)} MiB (top ${(r.filled.end.highestNonZeroBytes / 1048576).toFixed(1)} MiB)` : ''}${r.engineMem ? ` engine mem_peak ${r.engineMem.mem_peak}` : ''} | ticks ${r.ticksFinal}${r.renderer ? ` | ${String(r.renderer).slice(0, 80)}` : ''}`);
}
const summary = { label: LABEL, host: HOST, gpu: GPU, cart: CART, frames: FRAMES, runs: runs.length,
  p50_median: pct(runs.map((r) => r.frame_ms.p50), 50), p99_median: pct(runs.map((r) => r.frame_ms.p99), 50),
  p99_worst: Math.max(...runs.map((r) => r.frame_ms.p99)), max_worst: Math.max(...runs.map((r) => r.frame_ms.max)),
  done_p99_worst: runs[0].done_ms ? Math.max(...runs.map((r) => r.done_ms.p99)) : null,
  call_overhead_p50_median: runs[0].call_overhead_ms ? pct(runs.map((r) => r.call_overhead_ms.p50), 50) : null,
  heapBytes: runs.map((r) => r.heapBytes), filled: runs.map((r) => r.filled ?? null), engineMem: runs.map((r) => r.engineMem ?? null), ticksFinal: runs.map((r) => r.ticksFinal) };
writeFileSync(join(OUT, `${LABEL}.json`), `${JSON.stringify({ summary, runs })}\n`);
console.log(JSON.stringify(summary));
