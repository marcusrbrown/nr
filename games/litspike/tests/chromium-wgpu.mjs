// Runs a DUAL (GL + WebGPU) cart in headless Chromium on WebGPU, or on GL with --gpu gl, for N frames on a pinned
// 1/60 s clock and writes the last frame and the named debug state. The cart host is wasmcart's CartHostWeb
// (deps/cartwheel-engine/deps/wasmcart) and the page and clock follow tools/run-cart.mjs's Chromium host; this
// script exists because run-cart's --gpu webgpu reads a Linux test-GPU pin that has no macOS equivalent.
//
//   node games/litspike/tests/chromium-wgpu.mjs --cart out/litspike/build-cart-wgpu/carts/litspike.wasc \
//       --frames 60 --shot out.png --state out.json [--gpu webgpu|gl]
//
// The state carries `cw.gpu.api` (2 = WebGPU, 1 = GL) and `cw.gpu.errors`; the script exits 1 when the cart did not
// run on the requested API or counted WebGPU errors. No input is sent.
import { createServer } from 'node:http';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const ENGINE = join(ROOT, 'deps/cartwheel-engine');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const CART = resolve(ROOT, opt('cart', 'out/litspike/build-cart-wgpu/carts/litspike.wasc'));
const FRAMES = +opt('frames', 60);
const GPU = opt('gpu', 'webgpu');
const SHOT = opt('shot', null), STATE = opt('state', null);
if (!['webgpu', 'gl'].includes(GPU)) { console.error('--gpu webgpu|gl'); process.exit(2); }

process.env.CW_CHROMIUM_GPU ||= 'none';
process.env.CW_CHROMIUM_ARGS = [process.env.CW_CHROMIUM_ARGS || '', '--enable-unsafe-webgpu'].join(' ').trim();
const { launchChromium } = await import(join(ENGINE, 'tools/lib/chromium.mjs'));
const { writePng } = await import(join(ENGINE, 'tools/lib/png.mjs'));
const WC = join(ENGINE, 'deps/wasmcart');
const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.wasc': 'application/octet-stream', '.wasm': 'application/wasm' };

const page_html = `<!doctype html><html><body><canvas id=c></canvas>
<script type=importmap>{"imports":{"fflate":"/wc/node_modules/fflate/esm/browser.js"}}</script>
<script type=module>
import { CartHostWeb } from '/wc/src/CartHostWeb.js';
window.run = async (cfg) => {
  const host = new CartHostWeb();
  const canvas = document.getElementById('c');
  await host.load('/cart.wasc', { glBackend: () => canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true }),
    ...(cfg.gpu === 'webgpu' ? { adapterOptions: { powerPreference: 'high-performance' } } : { wgpu: false }) });
  const adapter = host.getGpuAdapterInfo ? host.getGpuAdapterInfo() : null;
  if (cfg.gpu === 'webgpu' && !host.usesWgpu) throw new Error('the cart did not run on WebGPU (usesWgpu false)');
  if (cfg.gpu === 'gl' && host.usesWgpu) throw new Error('the cart ran on WebGPU, GL was asked for');
  const info = host.getInfo();
  canvas.width = info.width; canvas.height = info.height;
  const step = 1000 / 60;
  let k = 0;
  host._writeTime = ((orig) => function () { orig.call(this, k * step, step, k); })(host._writeTime);
  const pads = [{ connected: true, buttons: 0 }, { connected: false }, { connected: false }, { connected: false }];
  {
    const ex = host.instance.exports;
    if (ex.wc_debug_state) {
      const dv = new DataView((host.memory || ex.memory).buffer);
      const str = (q) => { let s = ''; for (let b; (b = dv.getUint8(q)); q++) s += String.fromCharCode(b); return s; };
      const f = {};
      for (let p = ex.wc_debug_state(); ; p += 16) { const n = dv.getUint32(p, true); if (!n) break; f[str(n)] = { ptr: dv.getUint32(p + 4, true) }; }
      if (f['dbg.cmd']) {
        const bytes = new TextEncoder().encode('warmup_spread 0');
        for (let i = 0; i < bytes.length; i++) dv.setUint8(f['dbg.cmd'].ptr + i, bytes[i]);
        dv.setUint8(f['dbg.cmd'].ptr + bytes.length, 0);
        dv.setUint32(f['dbg.cmd_seq'].ptr, dv.getUint32(f['dbg.cmd_seq'].ptr, true) + 1, true);
      }
    }
  }
  let gframe = null;
  for (k = 0; k < cfg.frames; k++) {
    await host.runFrame(pads);
    if (cfg.gpu === 'webgpu' && k === cfg.frames - 1) gframe = await host.readGpuFrame();
    await new Promise((r) => setTimeout(r, 0));
  }
  let w, h, px;
  if (gframe) { w = gframe.width; h = gframe.height; px = new Uint8Array(gframe.data.buffer || gframe.data); }
  else {
    const gl = host.getGlContext();
    w = gl.drawingBufferWidth; h = gl.drawingBufferHeight;
    px = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  }
  const state = {};
  const ex = host.instance.exports;
  const dv = new DataView((host.memory ? host.memory.buffer : ex.memory.buffer));
  const str = (q) => { let s = ''; for (let b; (b = dv.getUint8(q)); q++) s += String.fromCharCode(b); return s; };
  for (let p = ex.wc_debug_state(); ; p += 16) {
    const name = dv.getUint32(p, true); if (!name) break;
    const vp = dv.getUint32(p + 4, true), type = dv.getUint8(p + 8), len = dv.getUint32(p + 12, true);
    const rd = [(q) => dv.getUint8(q), (q) => dv.getInt8(q), (q) => dv.getUint16(q, true), (q) => dv.getInt16(q, true),
      (q) => dv.getUint32(q, true), (q) => dv.getInt32(q, true), (q) => dv.getFloat32(q, true), (q) => dv.getFloat64(q, true)][type];
    const size = [1, 1, 2, 2, 4, 4, 4, 8][type];
    if (type === 8) { let hex = ''; for (let i = 0; i < len; i++) hex += dv.getUint8(vp + i).toString(16).padStart(2, '0'); state[str(name)] = hex; }
    else state[str(name)] = len === 1 ? rd(vp) : Array.from({ length: len }, (_, i) => rd(vp + i * size));
  }
  let b = '';
  for (let i = 0; i < px.length; i += 0x8000) b += String.fromCharCode.apply(null, px.subarray(i, i + 0x8000));
  return { w, h, px64: btoa(b), state, crossOriginIsolated, topDown: !!gframe, adapter, usesWgpu: !!host.usesWgpu };
};
window.ready = true;
</script></body></html>`;

const server = createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  let file = null, body = null;
  if (url === '/') body = page_html;
  else if (url === '/cart.wasc') file = CART;
  else if (url.startsWith('/wc/')) file = join(WC, url.slice(4));
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  if (body) { res.setHeader('Content-Type', 'text/html'); res.end(body); return; }
  if (!file || !existsSync(file)) { res.statusCode = 404; res.end(); return; }
  res.setHeader('Content-Type', MIME[extname(file)] || 'application/octet-stream');
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const { chromium } = await import(join(WC, 'node_modules', 'playwright', 'index.mjs'));
const { browser } = await launchChromium(chromium, join(ROOT, 'out'), []);
let code = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const logs = [];
  page.on('console', (m) => logs.push(m.text()));
  page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction('window.ready === true');
  const r = await page.evaluate((c) => window.run(c), { gpu: GPU, frames: FRAMES }).catch((e) => { throw new Error(`${e.message}\n${logs.join('\n')}`); });
  if (!r.crossOriginIsolated) throw new Error('page is not cross-origin isolated: threads cannot run');
  if (SHOT) writePng(resolve(SHOT), r.w, r.h, new Uint8Array(Buffer.from(r.px64, 'base64')), { flipY: !r.topDown });
  if (STATE) writeFileSync(resolve(STATE), JSON.stringify(r.state) + '\n');
  const api = r.state['cw.gpu.api'];
  const want = GPU === 'webgpu' ? 2 : 1;
  console.log(JSON.stringify({ host: 'chromium', gpu: GPU, frames: FRAMES, api, errors: r.state['cw.gpu.errors'], usesWgpu: r.usesWgpu, adapter: r.adapter,
    missing: r.state['cw.three.missing'], shot: SHOT, state: STATE }));
  if (api !== undefined && api !== want) { console.error(`ran on API ${api}, wanted ${want}`); code = 1; }
  if (r.state['cw.gpu.errors']) { console.error(`${r.state['cw.gpu.errors']} WebGPU error(s)\n${logs.join('\n')}`); code = 1; }
} catch (e) {
  console.error(e.message);
  code = 1;
} finally {
  await browser.close();
  server.close();
}
process.exit(code);
