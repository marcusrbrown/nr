// Native frame-time measurement of the wave-4 population (nr_stress: 8 grunts, a heavy, both heroes, the street block, four
// lights, every actor on a frame of its own so each is its own non-instanced draw).
//
//   CW_TEST_GPU=desktop node games/nr/tests/perf-native.mjs --build out/unit8/build-perf/native [--app nr_stress] [--runs 10]
//       [--label NAME] [--out out/unit8/perf]
//
// One run is the app started with CW_FRAMES=721 on the engine's flat-out loop (no vsync, no pacing): 120 warm-up frames
// (frames 0-119), then 600 measured frames (120-719); frame 720 only carries the end-of-run requests.
//
// Two frame-time series come from a run, both on the host's monotonic clock, never from the virtual clock:
//   submit  the engine profiler's wall_ms (`profile frames`, CW_PROFILE=1): frame start to the next frame start. The
//           offscreen swap does not wait for the GPU, so this is the CPU cost of submitting the frame.
//   done    nr.perf_ms from an NR_PERF build: render end to render end with a one-pixel readback after each frame, so every
//           frame includes its GPU work. The budget (16.6 ms) is judged on this series.
// Memory: RSS (ps, KiB) when the reply to the request posted at frame 121 and the end-of-run reply reach this process, peak
// RSS from /usr/bin/time -l, and the engine's per-tag byte counts (`stats`) answered by the app at those two frames.
// The GL backend only: the readback is glReadPixels.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };

const BUILD = resolve(ROOT, opt('build', 'out/unit8/build-perf/native'));
const APP = opt('app', 'nr_stress');
const RUNS = +opt('runs', 10);
const LABEL = opt('label', APP);
const OUT = resolve(ROOT, opt('out', 'out/unit8/perf'));
const WARMUP = 120, MEASURED = 600, FRAMES = WARMUP + MEASURED + 1;
mkdirSync(OUT, { recursive: true });

const exe = join(BUILD, 'games/nr', APP);
if (!existsSync(exe)) { console.error(`perf-native: no ${exe}`); process.exit(2); }

/** nearest-rank percentile of an unsorted array */
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.max(0, Math.ceil((p / 100) * s.length) - 1)]; };
const stats = (a) => ({ n: a.length, p50: pct(a, 50), p99: pct(a, 99), max: Math.max(...a), mean: a.reduce((x, y) => x + y, 0) / a.length });
const rssOf = (pid) => { const r = spawnSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }); const v = parseInt(r.stdout, 10); return Number.isFinite(v) ? v : null; };
const childOf = (pid) => { const r = spawnSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' }); const v = parseInt(r.stdout, 10); return Number.isFinite(v) ? v : null; };

function runOnce(n) {
  return new Promise((res, rej) => {
    const tag = `${LABEL}-${n}`;
    const dump = join(OUT, `${tag}.state.json`);
    const env = { ...process.env, CW_GPU: 'gl', CW_FRAMES: String(FRAMES), CW_FRAME_HZ: '60', CW_WARMUP_SPREAD: '0',
      SDL_AUDIODRIVER: 'dummy', CW_PROFILE: '1', CW_DEBUG_DUMP: dump, CW_ASSETS: existsSync(`${exe}.assets`) ? `${exe}.assets` : '',
      CW_START_CMDS: `@${WARMUP + 1} stats`, CW_DEBUG_CMDS: `stats;profile frames ${MEASURED + 1}` };
    for (const k of ['DISPLAY', 'WAYLAND_DISPLAY', 'WAYLAND_SOCKET', 'XAUTHORITY']) delete env[k];
    if (!env.CW_ASSETS) delete env.CW_ASSETS;
    const t0 = Date.now();
    const p = spawn('/usr/bin/time', ['-l', exe], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '', childPid = null;
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
      const lines = out.split('\n').filter((l) => l.startsWith('{'));
      const endStats = JSON.parse(lines.find((l) => l.includes('"mem_total"')));
      const prof = JSON.parse(lines.find((l) => l.includes('"columns"')));
      const warmStats = /start cmd: stats -> (\{.*\})/.exec(err);
      const peak = /(\d+)\s+maximum resident set size/.exec(err);
      const measured = prof.frames.filter((f) => f[0] >= WARMUP && f[0] < WARMUP + MEASURED); // [frame, cpu_ms, wall_ms, ticks]
      const state = JSON.parse(readFileSync(dump, 'utf8'));
      // perf_ms[j] is frame j + 1: its render end minus frame j's
      const done = state['nr.perf_ms'] ? state['nr.perf_ms'].slice(WARMUP - 1, WARMUP - 1 + MEASURED) : null;
      const run = { tag, app: APP, build: BUILD, frames: FRAMES, wallSeconds: (Date.now() - t0) / 1000,
        gl: (/GL: [^|\n]*\| ([^|]*) \|/.exec(err) || [])[1]?.trim() ?? null,
        measuredFrames: measured.length, actors: state['nr.actor_present']?.reduce((a, b) => a + b, 0),
        distinctFrames: new Set(state['nr.hero_frame'].map((f, i) => `${state['nr.actor_kind'][i] >= 2 ? state['nr.actor_kind'][i] : 0}:${f}`)).size,
        submit_ms: { ...stats(measured.map((f) => f[2])), cpuP99: pct(measured.map((f) => f[1]), 99) },
        done_ms: done ? stats(done) : null,
        ticksFinal: state['nr.ticks'], checksum: state['nr.checksum'], missing: state['cw.three.missing'],
        engineMem: { afterWarmup: warmStats ? JSON.parse(warmStats[1]) : null, end: endStats },
        rssKiB: { afterWarmup: rss.afterWarmup ?? null, end: rss.end ?? null, peak: peak ? Math.round(+peak[1] / 1024) : null },
        series: { submit: measured.map((f) => f[2]), done } };
      writeFileSync(join(OUT, `${tag}.json`), JSON.stringify(run));
      res(run);
    });
  });
}

const runs = [];
for (let n = 1; n <= RUNS; n++) {
  const r = await runOnce(n);
  runs.push(r);
  const d = r.done_ms, s = r.submit_ms;
  console.log(`${r.tag}: actors ${r.actors} (${r.distinctFrames} distinct frames) submit p50 ${s.p50.toFixed(3)} p99 ${s.p99.toFixed(3)} max ${s.max.toFixed(3)}` +
    (d ? ` | done p50 ${d.p50.toFixed(3)} p99 ${d.p99.toFixed(3)} max ${d.max.toFixed(3)}` : '') +
    ` | ticks ${r.ticksFinal} missing ${r.missing} rss ${r.rssKiB.afterWarmup}/${r.rssKiB.end}/${r.rssKiB.peak} KiB`);
}
const worst = (k, f) => Math.max(...runs.filter((r) => r[k]).map((r) => r[k][f]));
const med = (k, f) => pct(runs.filter((r) => r[k]).map((r) => r[k][f]), 50);
const summary = { label: LABEL, app: APP, actors: runs[0].actors, distinctFrames: runs[0].distinctFrames, runs: runs.length, gl: runs[0].gl,
  submit: { p50_median: med('submit_ms', 'p50'), p99_median: med('submit_ms', 'p99'), p99_worst: worst('submit_ms', 'p99'), max_worst: worst('submit_ms', 'max') },
  done: runs[0].done_ms ? { p50_median: med('done_ms', 'p50'), p99_median: med('done_ms', 'p99'), p99_worst: worst('done_ms', 'p99'), max_worst: worst('done_ms', 'max') } : null,
  missing: runs.map((r) => r.missing), checksums: [...new Set(runs.map((r) => r.checksum))], rssKiB: runs.map((r) => r.rssKiB), files: runs.map((r) => r.tag) };
writeFileSync(join(OUT, `${LABEL}.summary.json`), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary));
