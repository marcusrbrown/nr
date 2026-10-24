# Shipping-path spike: evidence

Plan: `docs/plans/2026-10-24-001-feat-shipping-path-spike-plan.md`. Pins and decisions: `docs/decisions/0001-engine-and-toolchain-pins.md`.

Raw logs cited below are under `out/unit2/` (gitignored, local to the development host).

## Predeclared acceptance criteria

Frozen before any spike frame exists. A change to a value below is recorded here as a dated amendment, with the reason, before the next measurement run.

### Fixed by the plan

- Stress actor count: 40.
- Native budget: frame time p99 ≤ 16.6 ms at 40 actors, vsync off, over the sampling window below.

### Baseline actor count

8 (two players and six enemies).

### Sampling

Per actor count (8 and 40): 120 warm-up frames, then 600 measured frames (10 s of simulated time at 60 Hz). Warm-up frames are excluded from every statistic. Reported per host: p50, p99, max frame time. Cart hosts are timed externally on GPU-completed frames with host/readback overhead as a separate column. Timing is never derived from the virtual clock. Memory: native RSS and wasm linear-memory size, each as a snapshot after the measured window.

### Compared field whitelist

Compared exactly across native, romdev and Chromium for the same input script:

- actor positions (x, y, z per actor, by actor id)
- jump heights
- rng cursor
- actor count
- `sfx_tick`
- voice-created flag
- tick count
- input count
- rolling per-tick simulation checksum

Excluded: raw frame count (romdev runs a frame at load), presentation and audio timings, `host.*` fields, `cw.*` transport and mailbox fields, HUD atlas page count (published separately, HUD-only). A missing or non-finite whitelisted value rejects the comparison; no tolerance applies to any whitelisted field.

### Image tolerance calibration

Metric: the engine gate's `gt16`, the share of pixels whose channel difference exceeds 16 levels, per host pair, against the native frame (stock `tests/gate.mjs` shape). A 0×0 or size-mismatched frame rejects before any metric is computed.

1. Collect a known-good set for the spike scene: native vs romdev, native vs Chromium, and native vs native with only a tick-counter-bearing HUD value changed. The tick-counter-only change must pass.
2. Collect a known-bad set: a blank frame, and a frame rendered in the wrong colour space. Each must fail independently.
3. Per host pair, the tolerance is `2 × max(good-set gt16)`, with a floor of 0.0005 (the engine's stock `maxGt16` for 3D samples). It is accepted only if it is at most `min(bad-set gt16) / 2`. If no such gap exists, the image gate is reported as failed-to-calibrate; the tolerance is not widened to fit.
4. Each pair's tolerance and the calibration inputs are committed with `tests/gates.json`.

## Unit 2 runner smoke test

Date: 2026-10-24. Host: macOS 15.7.9 arm64 (Apple M1 Pro), Apple clang 17.0.0 (clang-1700.6.4.2), cmake 4.4.4, ninja 1.13.2, node v24.22.1, bun 1.4.4. Full tuple: `build/tuple.json` (`out/unit2/preflight.log`).

App: engine sample `hello` (a three.c cube, 120 frames, input script `hello-input.json`, 1920×1080). The sample's source and its committed program table (`samples/programs/cw_samples.*`) were copied from the pinned engine checkout into a scratch project at `out/unit2/smoke/` (gitignored) with a root `CMakeLists.txt` of `find_package(cartwheel REQUIRED CONFIG)` and one `cw_add_app(hello ...)`. Both targets were built with the project's `scripts/build.sh` copy (`TARGETS=native`, `TARGETS=cart`), against the pinned SDKs, with `CW_PROJECT_ROOT` pointing at the scratch project.

### Fetch and preflight

| Check | Result | Log |
| --- | --- | --- |
| `scripts/fetch-deps.sh` on a clean `deps/` | exit 0, 39 s; both SDKs, wasi-sdk 33.0 (clang 22.1.0-wasi-sdk, Mach-O arm64), Binaryen 123, engine checkout, three.c, wasmcart with `npm ci`, Playwright Chromium headless shell 151.0.7922.34 | `fetch.log` |
| Tampered cart-SDK sha256 in a copy of the lock | exit 1, `sha256 mismatch (lock …, got …)`; no `cart` SDK directory, no `.stage.*`, no `.part` left | `fetch-tamper.log` |
| `scripts/preflight.sh` | exit 0, wrote `build/tuple.json` | `preflight.log` |
| `scripts/preflight.sh` with ninja off `PATH` | exit 1, `missing required tool(s): ninja` | `preflight-no-ninja.log` |
| `scripts/build.sh` with no root `CMakeLists.txt` | exit 1, `no CMakeLists.txt … the project has no build to run yet` | `build-no-cmakelists.log` |
| `TARGETS=native scripts/build.sh` (smoke project) | exit 0, 1.5 s | `smoke-build-native.log` |
| `TARGETS=cart scripts/build.sh` (smoke project) | exit 0, 19.5 s; `hello.wasc` 2,575,171 bytes; the Darwin wasi-sdk linked the cart SDK's ThinLTO bitcode (data point for Unit 4, for this one app) | `smoke-build-cart.log` |

### Darwin launch settings

| Command | Env | Result |
| --- | --- | --- |
| `run-cart.mjs --host native` | `CW_PROJECT_ROOT` only | exit 1: `GPU test runs need the test GPU in ~/.config/cartwheel/chromium-gpu …` (`enterGpuSandbox`) (`native-noenv.log`) |
| `run-cart.mjs --host native` | `CW_PROJECT_ROOT`, `CW_TEST_GPU=desktop` | exit 0, 1.4 s, non-blank frame (`native-desktop.log`) |
| `run-cart.mjs --host chromium` | same | exit 0, 1920×1080 frame (`chromium-smoke.log`, `chromium-repeat.log`) |
| `run-cart.mjs --host romdev` | same | exit 0 on a romdev whose GL module loads; exit 1 on the stock install (below) |
| `tests/gate.mjs hello-input` | `CW_PROJECT_ROOT`, `CW_TEST_GPU=desktop` | exit 1: `armGuard()` calls the test-GPU lookup before honouring the opt-out (observed; that run's log was overwritten by the next one) |
| `tests/gate.mjs hello-input` | `CW_PROJECT_ROOT`, `CW_TEST_GPU=software`, `CW_WGPU_ADAPTER=apple` | the engine's no-op guard; the native GL renderer check passes against `ANGLE (Apple, Apple M1 Pro, OpenGL 4.1 Metal - 89.4)` |

The Linux bubblewrap sandbox and PCI discovery are skipped by those settings; no project-owned adapter was required. Native audio runs on SDL's dummy driver (the runner's default). No window opens (the runner selects SDL's offscreen video driver).

### Per-host verdict

| Host | Command result | Cross-host state (`ticks`, `x`, `angle`, `input.hash`, `input.ticks`) |
| --- | --- | --- |
| native | exit 0 | 120, 0.6666667461395264, 3.000002384185791, 1995982987, 120 |
| chromium (Playwright headless shell, GL) | exit 0 | identical to native |
| romdev, stock `romdevtools` 0.150.2 install on `:7331` | exit 1: `romdev requires headless GL for wasmcart GL carts, but webgl-node/native-gles failed to load` (`romdev-smoke.log`) | not produced |
| romdev, same version with the GL module repaired (copy on `:7332`) | exit 0 (`romdev-smoke-repaired.log`) | identical to native |
| `tests/gate.mjs hello-input` against the stock romdev | exit 1; only the romdev leg is reported failing, with the same load error (`gate-stock-romdev.log`) | |
| `tests/gate.mjs hello-input` against the repaired romdev | exit 0: `ok hello-input (native, romdev, chromium)`, its control (native one frame early) fails as required (`gate-repaired-romdev.log`) | |

Image data points from the gate's own frames (`image-diff-hello.log`): native vs Chromium, native vs romdev and Chromium vs romdev are pixel-identical (`gt16` 0, `max` 0) for this sample; native vs the one-frame-early control has `gt16` 0.00119 (stock `maxGt16` 0.0005).

### romdev host findings

- The installed `romdevtools` 0.150.2 (`~/.local/share/mise/installs/npm-romdevtools/0.150.2`) contains `gles.node` files that are Linux x86-64 ELF (`node_modules/native-gles/dist/`, `node_modules/webgl-node/node_modules/native-gles/dist/`). Loading them on macOS fails with `slice is not valid mach-o file`. Every wasmcart GL `loadMedia` on that server fails.
- Repair that worked, tried in a copy (`/tmp/romdev-copy`, server on `:7332`; the owner's install and server were not changed): in `node_modules/webgl-node/node_modules/native-gles`, `node scripts/download-release.mjs` fetched `gles.node-v0.7.1-darwin-arm64.tar.gz` (Mach-O arm64 bundle); `import("webgl-node")` then loads. The top-level `node_modules/native-gles` (0.6.1) is also ELF and was not needed for the smoke run.
- `run-cart.mjs` hard-codes `http://127.0.0.1:7331` and uses its own session id `cartwheel-run-<app>-<pid>`. To drive the copy on `:7332` a 3-line `fetch` preload (`--import`, rewriting the port) was used, kept in `out/unit2/romdev-port-shim.mjs` (not committed).
- Wasmcart reports: `wasm{op:info}` on the loaded `hello.wasc` gives ABI `version: 4`; `wasm{op:conformance}` gives `conforms: true` with one warning (`deterministic-unflagged`: the cart exports `wc_set_seed()` without `WC_FLAG_DETERMINISTIC`). The host's wasmcart package is 0.34.5 (`node_modules/wasmcart`), recorded in `tuple.json` as `romdev.wasmcart_runtime_version`; neither `/healthz` nor `/openapi.json` reports it.
- Visible play: `loadMedia` (wasmcart, `deterministicStepMs` 1000/60, seed 1) then `host{op:play, seconds:30}` on the repaired copy at 60 fps, session `nr-unit2-smoke-hello` throughout (`romdev-play-7332.log`). The same two calls on the stock `:7331` server failed at `loadMedia` with the GL-module error, so its `/livestream` showed nothing (`romdev-play-7331.log`).

### Environment observations

- The Docker client is installed (29.6.2-rd); the daemon was not running (`docker version` cannot reach `/var/run/docker.sock`). `tuple.json` records `docker.server: null`.
- The first Chromium run after the Playwright install wrote a 0×0 PNG and exited 0. Eight later standalone runs (two settings checks, six repeats) and the gate runs wrote correct 1920×1080 frames (`chromium-repeat.log`). Cause not established. The Unit 5 image gate rejects 0×0 frames before computing a metric (see calibration above).

## Unverified

- `programs.mjs` (program survey against a non-engine build directory) was not run in Unit 2.
- The `wasi-sdk` sha256 has no second upstream source (no checksum asset); the fetch script verifies against the GitHub API digest.
- Audible audio on native and Chromium was not checked (dummy audio driver).
- The cause of the single 0×0 Chromium frame.
- Whether the owner's `:7331` server can be repaired the same way in place (only a copy was repaired).
