// Native frame-time measurement for the spike apps (docs/evidence/shipping-path-spike/README.md, "Unit 6").
//
//   CW_TEST_GPU=desktop node games/spike/tests/perf-native.mjs --build build/native --app spike_stress \
//       [--input games/spike/tests/input-stress.json] [--runs 5] [--label NAME] [--trace] [--out out/unit6/perf]
//
// One run is the app started with CW_FRAMES=721 on the engine's flat-out loop (no vsync, no pacing): 120 warm-up
// frames (frames 0-119), then 600 measured frames (120-719); frame 720 only carries the end-of-run requests.
//
// Two frame-time series come from a run, both on the host's monotonic clock, never from the virtual clock:
//   submit  the engine profiler's wall_ms (`profile frames`, CW_PROFILE=1): frame start to the next frame start.
//           The offscreen swap does not wait for the GPU, so this is the CPU cost of submitting the frame.
//   done    spike.perf_ms from a SPIKE_PERF build: render end to render end with a one-pixel readback after each
//           frame, so every frame includes its GPU work. This is the series the budget is judged on.
// --trace records the profiler's Chrome trace for the whole run and counts `text.glyph_bake` zones per frame.
//
// Memory: RSS (ps, KiB) read when the reply to the request posted at frame 121 (after the warm-up) and the
// end-of-run reply reach this process, peak RSS from /usr/bin/time -l, and the engine's per-tag byte counts
// (`stats`) answered by the app itself at those two frames.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const flag = (k) => argv.includes('--' + k);

const BUILD = resolve(ROOT, opt('build', 'build/native'));
const APP = opt('app', 'spike_stress');
const INPUT = opt('input', null);
const RUNS = +opt('runs', 5);
const LABEL = opt('label', `${APP}${INPUT ? '-input' : ''}`);
const OUT = resolve(ROOT, opt('out', 'out/unit6/perf'));
const TRACE = flag('trace');
const WARMUP = 120, MEASURED = 600, FRAMES = WARMUP + MEASURED + 1;
mkdirSync(OUT, { recursive: true });

const exe = join(BUILD, 'games/spike', APP);
if (!existsSync(exe)) { console.error(`perf-native: no ${exe}`); process.exit(2); }

const CW_BITS = { south: 0, east: 1, west: 2, north: 3, back: 4, guide: 5, start: 6, l3: 7, r3: 8, l: 9, r: 10, up: 11, down: 12, left: 13, right: 14 };
const mask = (names) => (names || []).reduce((m, n) => m | (1 << CW_BITS[n]), 0);
function inputFile(path, dest) {
  const script = JSON.parse(readFileSync(path, 'utf8'));
  const AX = ['lx', 'ly', 'rx', 'ry', 'lt', 'rt'];
  const lines = script.map((s) => {
    const parts = [s.frame - 1, mask(s.buttons), ...AX.map((a) => (s.axes || {})[a] || 0)];
    if (s.pad2) parts.push(`p=${mask(s.pad2.buttons)},${(s.pad2.axes || {}).lx || 0},${(s.pad2.axes || {}).ly || 0}`);
    return parts.join(' ');
  });
  writeFileSync(dest, lines.join('\n') + '\n');
  return dest;
}

/** nearest-rank percentile of an unsorted array */
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.max(0, Math.ceil((p / 100) * s.length) - 1)]; };
const stats = (a) => ({ n: a.length, p50: pct(a, 50), p99: pct(a, 99), max: Math.max(...a), mean: a.reduce((x, y) => x + y, 0) / a.length });
const rssOf = (pid) => { const r = spawnSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }); const v = parseInt(r.stdout, 10); return Number.isFinite(v) ? v : null; };
const childOf = (pid) => { const r = spawnSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' }); const v = parseInt(r.stdout, 10); return Number.isFinite(v) ? v : null; };

function runOnce(n) {
  return new Promise((res, rej) => {
    const tag = `${LABEL}-${n}`;
    const dump = join(OUT, `${tag}.state.json`);
    const trace = join(OUT, `${tag}.trace.json`);
    const env = { ...process.env, CW_GPU: 'gl', CW_FRAMES: String(FRAMES), CW_FRAME_HZ: '60', CW_WARMUP_SPREAD: '0',
      SDL_AUDIODRIVER: 'dummy', CW_PROFILE: '1', CW_DEBUG_DUMP: dump, CW_ASSETS: existsSync(exe + '.assets') ? exe + '.assets' : '',
      CW_START_CMDS: `@${WARMUP + 1} fields spike.hud_atlas_pages r2d.atlas_pages r2d.glyphs_missing r2d.texture_uploads;@${WARMUP + 1} stats`,
      CW_DEBUG_CMDS: `fields spike.hud_atlas_pages r2d.atlas_pages r2d.glyphs_missing r2d.texture_uploads;stats;profile frames ${MEASURED + 1}` };
    for (const k of ['DISPLAY', 'WAYLAND_DISPLAY', 'WAYLAND_SOCKET', 'XAUTHORITY']) delete env[k];
    if (!env.CW_ASSETS) delete env.CW_ASSETS;
    if (INPUT) env.CW_INPUT = inputFile(resolve(ROOT, INPUT), join(OUT, `${tag}.input.txt`));
    if (TRACE) Object.assign(env, { CW_PROFILE_TRACE: trace, CW_PROFILE_TRACE_START: '0', CW_PROFILE_TRACE_FRAMES: String(FRAMES) });
    const t0 = Date.now();
    const p = spawn('/usr/bin/time', ['-l', exe], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    let childPid = null;
    const rss = {};
    p.stdout.on('data', (d) => {
      out += d;
      if (rss.end === undefined && out.includes('"mem_total"')) {
        childPid ??= childOf(p.pid);
        if (childPid) rss.end = rssOf(childPid);
      }
    });
    p.stderr.on('data', (d) => {
      err += d;
      if (rss.afterWarmup === undefined && /start cmd: stats ->/.test(err)) {
        childPid ??= childOf(p.pid);
        if (childPid) rss.afterWarmup = rssOf(childPid);
      }
    });
    p.on('close', (code) => {
      if (code !== 0) return rej(new Error(`${tag}: exit ${code}: ${err.slice(-1500)}`));
      const wallSeconds = (Date.now() - t0) / 1000;
      const lines = out.split('\n').filter((l) => l.startsWith('{'));
      const parse = (l) => JSON.parse(l);
      const endFields = parse(lines.find((l) => l.includes('"spike.hud_atlas_pages"')));
      const endStats = parse(lines.find((l) => l.includes('"mem_total"')));
      const prof = parse(lines.find((l) => l.includes('"columns"')));
      const warmFields = /start cmd: fields [^>]*-> (\{.*\})/.exec(err);
      const warmStats = /start cmd: stats -> (\{.*\})/.exec(err);
      const peak = /(\d+)\s+maximum resident set size/.exec(err);
      const frameLines = prof.frames; // [frame, cpu_ms, wall_ms, ticks]
      const measured = frameLines.filter((f) => f[0] >= WARMUP && f[0] < WARMUP + MEASURED);
      const submit = measured.map((f) => f[2]);
      const state = JSON.parse(readFileSync(dump, 'utf8'));
      let done = null;
      if (state['spike.perf_ms']) {
        // perf_ms[j] is frame j + 1: its render end minus frame j's
        done = state['spike.perf_ms'].slice(WARMUP - 1, WARMUP - 1 + MEASURED);
      }
      const run = {
        tag, app: APP, input: INPUT, build: BUILD, frames: FRAMES, wallSeconds,
        gl: (/GL: [^|\n]*\| ([^|]*) \|/.exec(err) || [])[1]?.trim() ?? null,
        measuredFrames: measured.length,
        submit_ms: { ...stats(submit), cpuP99: pct(measured.map((f) => f[1]), 99) },
        done_ms: done ? stats(done) : null,
        ticksFinal: state['spike.ticks'], checksum: state['spike.checksum'], missing: state['cw.three.missing'],
        atlas: { afterWarmup: warmFields ? JSON.parse(warmFields[1]) : null, end: endFields },
        engineMem: { afterWarmup: warmStats ? JSON.parse(warmStats[1]) : null, end: endStats },
        rssKiB: { afterWarmup: rss.afterWarmup ?? null, end: rss.end ?? null, peak: peak ? Math.round(+peak[1] / 1024) : null },
        series: { submit, done },
      };
      if (TRACE) run.glyph = glyphBakes(trace);
      writeFileSync(join(OUT, `${tag}.json`), JSON.stringify(run));
      res(run);
    });
  });
}

/** text.glyph_bake zones of a Chrome trace, counted per engine frame (`frame` zones carry args.frame) */
function glyphBakes(file) {
  const ev = JSON.parse(readFileSync(file, 'utf8'));
  const events = Array.isArray(ev) ? ev : ev.traceEvents;
  const frames = events.filter((e) => e.name === 'frame' && e.ph === 'X' && e.args && e.args.frame !== undefined);
  const bakes = events.filter((e) => e.name === 'text.glyph_bake');
  // frame 0 holds the app's init (the HUD glyph preload); frames 1.. are the running loop
  const counts = { frame0: 0, afterFrame0: 0, warmup: 0, measured: 0, outsideFrames: 0, total: bakes.length, tracedFrames: frames.length, byFrame: {} };
  for (const b of bakes) {
    const f = frames.find((fr) => b.ts >= fr.ts && b.ts <= fr.ts + fr.dur);
    if (!f) { counts.outsideFrames++; continue; }
    const k = f.args.frame;
    counts.byFrame[k] = (counts.byFrame[k] || 0) + 1;
    if (k === 0) counts.frame0++;
    else counts.afterFrame0++;
    if (k < WARMUP) counts.warmup++;
    else if (k < WARMUP + MEASURED) counts.measured++;
  }
  return counts;
}

const runs = [];
for (let n = 1; n <= RUNS; n++) {
  const r = await runOnce(n);
  runs.push(r);
  const d = r.done_ms, s = r.submit_ms;
  console.log(`${r.tag}: submit p50 ${s.p50.toFixed(3)} p99 ${s.p99.toFixed(3)} max ${s.max.toFixed(3)}` +
    (d ? ` | done p50 ${d.p50.toFixed(3)} p99 ${d.p99.toFixed(3)} max ${d.max.toFixed(3)}` : '') +
    ` | ticks ${r.ticksFinal} missing ${r.missing} atlas ${r.atlas.afterWarmup?.['spike.hud_atlas_pages']}->${r.atlas.end['spike.hud_atlas_pages']}` +
    ` rss ${r.rssKiB.afterWarmup}/${r.rssKiB.end}/${r.rssKiB.peak} KiB` + (r.glyph ? ` glyph ${JSON.stringify(r.glyph)}` : ''));
}
const worst = (k, f) => Math.max(...runs.filter((r) => r[k]).map((r) => r[k][f]));
const med = (k, f) => pct(runs.filter((r) => r[k]).map((r) => r[k][f]), 50);
const summary = { label: LABEL, app: APP, input: INPUT, runs: runs.length, gl: runs[0].gl,
  submit: { p50_median: med('submit_ms', 'p50'), p99_median: med('submit_ms', 'p99'), p99_worst: worst('submit_ms', 'p99'), max_worst: worst('submit_ms', 'max') },
  done: runs[0].done_ms ? { p50_median: med('done_ms', 'p50'), p99_median: med('done_ms', 'p99'), p99_worst: worst('done_ms', 'p99'), max_worst: worst('done_ms', 'max') } : null,
  files: runs.map((r) => r.tag) };
writeFileSync(join(OUT, `${LABEL}.summary.json`), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary));
