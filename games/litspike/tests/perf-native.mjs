// Native frame-time measurement for the litspike apps (the pattern of games/spike/tests/perf-native.mjs).
//
//   CW_TEST_GPU=desktop node games/litspike/tests/perf-native.mjs --build out/litspike/build-perf/native \
//       --app litspike_stress [--runs 5] [--label NAME] [--out out/litspike/perf]
//
// One run is the app started with CW_FRAMES=721 on the engine's flat-out loop (no vsync, no pacing): 120 warm-up
// frames (frames 0-119), then 600 measured frames (120-719); frame 720 only carries the end-of-run requests.
// Two frame-time series come from a run, both on the host's monotonic clock, never from the virtual clock:
//   submit  the engine profiler's wall_ms (`profile frames`, CW_PROFILE=1): frame start to the next frame start;
//           the CPU cost of submitting the frame.
//   done    lit.perf_ms from a LITSPIKE_PERF build: render end to render end with a one-pixel readback after each
//           frame, so every frame includes its GPU work. The budget (16.6 ms) is judged on this series.
// The GL backend only: the readback is glReadPixels.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };

const BUILD = resolve(ROOT, opt('build', 'out/litspike/build-perf/native'));
const APP = opt('app', 'litspike_stress');
const RUNS = +opt('runs', 5);
const LABEL = opt('label', APP);
const OUT = resolve(ROOT, opt('out', 'out/litspike/perf'));
const WARMUP = 120, MEASURED = 600, FRAMES = WARMUP + MEASURED + 1;
mkdirSync(OUT, { recursive: true });

const exe = join(BUILD, 'games/litspike', APP);
if (!existsSync(exe)) { console.error(`perf-native: no ${exe}`); process.exit(2); }

/** nearest-rank percentile of an unsorted array */
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.max(0, Math.ceil((p / 100) * s.length) - 1)]; };
const stats = (a) => ({ n: a.length, p50: pct(a, 50), p99: pct(a, 99), max: Math.max(...a), mean: a.reduce((x, y) => x + y, 0) / a.length });

function runOnce(n) {
  return new Promise((res, rej) => {
    const tag = `${LABEL}-${n}`;
    const dump = join(OUT, `${tag}.state.json`);
    const env = { ...process.env, CW_GPU: 'gl', CW_FRAMES: String(FRAMES), CW_FRAME_HZ: '60', CW_WARMUP_SPREAD: '0',
      SDL_AUDIODRIVER: 'dummy', CW_PROFILE: '1', CW_DEBUG_DUMP: dump, CW_ASSETS: existsSync(exe + '.assets') ? exe + '.assets' : '',
      CW_DEBUG_CMDS: `profile frames ${MEASURED + 1}` };
    for (const k of ['DISPLAY', 'WAYLAND_DISPLAY', 'WAYLAND_SOCKET', 'XAUTHORITY']) delete env[k];
    if (!env.CW_ASSETS) delete env.CW_ASSETS;
    const p = spawn(exe, [], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => {
      if (code !== 0) return rej(new Error(`${tag}: exit ${code}: ${err.slice(-1500)}`));
      const prof = JSON.parse(out.split('\n').filter((l) => l.startsWith('{')).find((l) => l.includes('"columns"')));
      const measured = prof.frames.filter((f) => f[0] >= WARMUP && f[0] < WARMUP + MEASURED); // [frame, cpu_ms, wall_ms, ticks]
      const state = JSON.parse(readFileSync(dump, 'utf8'));
      // perf_ms[j] is frame j + 1: its render end minus frame j's
      const done = state['lit.perf_ms'].slice(WARMUP - 1, WARMUP - 1 + MEASURED);
      const run = { tag, app: APP, build: BUILD, frames: FRAMES, actors: state['lit.actors'],
        gl: (/GL: [^|\n]*\| ([^|]*) \|/.exec(err) || [])[1]?.trim() ?? null,
        submit_ms: stats(measured.map((f) => f[2])), done_ms: stats(done),
        ticksFinal: state['lit.ticks'], checksum: state['lit.checksum'], missing: state['cw.three.missing'] };
      writeFileSync(join(OUT, `${tag}.json`), JSON.stringify(run));
      res(run);
    });
  });
}

const runs = [];
for (let n = 1; n <= RUNS; n++) {
  const r = await runOnce(n);
  runs.push(r);
  console.log(`${r.tag}: actors ${r.actors} submit p50 ${r.submit_ms.p50.toFixed(3)} p99 ${r.submit_ms.p99.toFixed(3)} max ${r.submit_ms.max.toFixed(3)}` +
    ` | done p50 ${r.done_ms.p50.toFixed(3)} p99 ${r.done_ms.p99.toFixed(3)} max ${r.done_ms.max.toFixed(3)} | ticks ${r.ticksFinal} missing ${r.missing}`);
}
const worst = (k, f) => Math.max(...runs.map((r) => r[k][f]));
const med = (k, f) => pct(runs.map((r) => r[k][f]), 50);
const summary = { label: LABEL, app: APP, actors: runs[0].actors, runs: runs.length, gl: runs[0].gl,
  submit: { p50_median: med('submit_ms', 'p50'), p99_median: med('submit_ms', 'p99'), p99_worst: worst('submit_ms', 'p99'), max_worst: worst('submit_ms', 'max') },
  done: { p50_median: med('done_ms', 'p50'), p99_median: med('done_ms', 'p99'), p99_worst: worst('done_ms', 'p99'), max_worst: worst('done_ms', 'max') },
  missing: runs.map((r) => r.missing), files: runs.map((r) => r.tag) };
writeFileSync(join(OUT, `${LABEL}.summary.json`), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary));
