// Plays a spike cart in Chromium in real time with sound, for the browser half of the audible smoke check, or checks
// headlessly that the browser host drains audio from the cart.
//
//   CW_TEST_GPU=desktop node games/spike/tests/chromium-audio.mjs [--cart build/cart/carts/spike.wasc]
//       opens a Chromium window; click it once (browsers start audio on a gesture); arrows move player 0,
//       Space jumps, J attacks (the blip). Close the window to exit.
//   CW_TEST_GPU=desktop node games/spike/tests/chromium-audio.mjs --check
//       headless (--shot <png> also saves the page): presses J at frame 60 and prints the peak sample drained from the cart's audio ring per frame
//       window; exit 0 when the frames before the attack are silent and the frames after it are not.
//
// Keys reach the cart as SDL scancodes through CartHostWeb.keyDown, as run-cart's Chromium host sends them.
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromiumArgs, chromiumEnv } from '../../../deps/cartwheel-engine/tools/lib/chromium.mjs';
import { workersOverride } from '../../../deps/cartwheel-engine/tools/lib/workers.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const argv = process.argv.slice(2);
const check = argv.includes('--check');
const cart = resolve(REPO, argv.includes('--cart') ? argv[argv.indexOf('--cart') + 1] : 'build/cart/carts/spike.wasc');
const WC = join(REPO, 'deps/cartwheel-engine/deps/wasmcart');
if (!existsSync(cart)) { console.error(`no cart at ${cart}: run scripts/build.sh`); process.exit(2); }

const page_html = `<!doctype html><html><body style="margin:0;background:#000;display:flex;align-items:center;justify-content:center;height:100vh">
<canvas id=c style="max-width:100vw;max-height:100vh"></canvas>
<script type=importmap>{"imports":{"fflate":"/wc/node_modules/fflate/esm/browser.js"}}</script>
<script type=module>
import { CartHostWeb } from '/wc/src/CartHostWeb.js';
const SC = { ArrowRight: 79, ArrowLeft: 80, ArrowDown: 81, ArrowUp: 82, Space: 44, KeyJ: 13 };
const canvas = document.getElementById('c');
const host = new CartHostWeb();
await host.load('/cart.wasc', { glBackend: () => canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true }), wgpu: false });
const info = host.getInfo();
canvas.width = info.width; canvas.height = info.height;
const pads = [{ connected: true, buttons: 0 }, { connected: false }, { connected: false }, { connected: false }];
let ac = null, next = 0;
const pump = (samples) => {
  if (!ac || !samples || !samples.length) return;
  const n = samples.length >> 1, buf = ac.createBuffer(2, n, 48000);
  const l = buf.getChannelData(0), r = buf.getChannelData(1);
  for (let i = 0; i < n; i++) { l[i] = samples[2 * i]; r[i] = samples[2 * i + 1]; }
  const src = ac.createBufferSource(); src.buffer = buf; src.connect(ac.destination);
  next = Math.max(next, ac.currentTime + 0.03); src.start(next); next += buf.duration;
};
window.peaks = [];
window.press = (code, down) => (down ? host.keyDown(SC[code]) : host.keyUp(SC[code]));
if (!${check}) {
  addEventListener('click', () => { if (!ac) ac = new AudioContext({ sampleRate: 48000 }); ac.resume(); });
  addEventListener('keydown', (e) => { if (SC[e.code] !== undefined) { host.keyDown(SC[e.code]); e.preventDefault(); } });
  addEventListener('keyup', (e) => { if (SC[e.code] !== undefined) host.keyUp(SC[e.code]); });
  let last = performance.now(), acc = 0;
  const tick = async (t) => {
    acc = Math.min(acc + (t - last), 100); last = t;
    while (acc >= 1000 / 60) { acc -= 1000 / 60; const f = await host.runFrame(pads); pump(f && f.audio); }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
} else {
  window.runFrames = async (n) => {
    for (let i = 0; i < n; i++) {
      const f = await host.runFrame(pads);
      let peak = 0;
      if (f && f.audio) for (let j = 0; j < f.audio.length; j++) peak = Math.max(peak, Math.abs(f.audio[j]));
      window.peaks.push(peak);
      await new Promise((r) => setTimeout(r, 0));
    }
  };
}
window.ready = true;
</script></body></html>`;

const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.wasc': 'application/octet-stream', '.wasm': 'application/wasm' };
const server = createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  let file = null;
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  if (url === '/') { res.setHeader('Content-Type', 'text/html'); res.end(page_html); return; }
  if (url === '/cart.wasc') file = cart;
  else if (url.startsWith('/wc/')) file = join(WC, url.slice(4));
  if (!file || !existsSync(file)) { res.statusCode = 404; res.end(); return; }
  res.setHeader('Content-Type', MIME[extname(file)] || 'application/octet-stream');
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const { chromium } = await import(join(WC, 'node_modules', 'playwright', 'index.mjs'));
const browser = await chromium.launch({ headless: check, args: [...chromiumArgs(), ...(check ? [] : ['--autoplay-policy=no-user-gesture-required'])], env: chromiumEnv() });
let code = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('console', (m) => console.error(m.text()));
  page.on('pageerror', (e) => console.error('pageerror: ' + e.message));
  await workersOverride(page);
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction('window.ready === true', null, { timeout: 60000 });
  if (check) {
    await page.evaluate(() => window.runFrames(60));
    await page.evaluate(() => window.press('KeyJ', true));
    await page.evaluate(() => window.runFrames(2));
    await page.evaluate(() => window.press('KeyJ', false));
    await page.evaluate(() => window.runFrames(58));
    if (argv.includes('--shot')) await page.screenshot({ path: resolve(argv[argv.indexOf('--shot') + 1]) });
    const peaks = await page.evaluate(() => window.peaks);
    const before = Math.max(...peaks.slice(0, 60)), after = Math.max(...peaks.slice(60));
    console.log(JSON.stringify({ frames: peaks.length, peakBeforeAttack: before, peakAfterAttack: after }));
    if (!(before === 0 && after > 0)) { console.error('FAIL: expected silence before the attack and sound after it'); code = 1; }
    else console.log('ok   the browser host drains non-silent audio after the attack and none before');
  } else {
    console.log('Chromium window open: click it, then press J (attack) to hear the blip; close the window to exit.');
    await page.waitForEvent('close', { timeout: 0 });
  }
} finally {
  await browser.close().catch(() => {});
  server.close();
}
process.exit(code);
