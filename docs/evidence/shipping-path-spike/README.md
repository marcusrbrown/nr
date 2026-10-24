# Shipping-path spike: evidence

Plan: `docs/plans/2026-10-24-001-feat-shipping-path-spike-plan.md`. Pins and decisions: `docs/decisions/0001-engine-and-toolchain-pins.md`.

Raw logs cited below are under `out/unit2/`, `out/unit3/` and `out/unit45/` (gitignored, local to the development host).

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

- `programs.mjs` (program survey against a non-engine build directory) was not run in Unit 2 (Unit 3 ran it against the native build; Unit 5 against cart runs).
- The `wasi-sdk` sha256 has no second upstream source (no checksum asset); the fetch script verifies against the GitHub API digest.
- Audible audio on native and Chromium was not checked (dummy audio driver).
- The cause of the single 0×0 Chromium frame.
- Whether the owner's `:7331` server can be repaired the same way in place (only a copy was repaired). Resolved after Unit 2: the `:7331` server loads GL carts (Unit 3 and Unit 5 runs); how it was repaired is not recorded here.

## Unit 3: spike scene and native build

Date: 2026-10-24. Raw logs and images: `out/unit3/` (gitignored, local to the development host). Sources: `games/spike/`, root `CMakeLists.txt`.

- Targets: `spike` (8 actors, the baseline) and `spike_stress` (40 actors) are two `cw_add_app` targets over one `main.c`; the count is the compile definition `SPIKE_ACTORS`, so no input script can change it. Both link the committed table `games/spike/programs/spike.txt` (`basic+map+nearest+atest`, `basic+map+nearest+instbig+atest`, `standard+l1000`).
- Program survey: `node deps/cartwheel-engine/tools/programs.mjs spike spike_stress --no-run --logs <dir> --build build/native` with `<dir>` holding the `CW_PROGRAMS_LOG_DIR` logs of `run-cart` runs (`out/unit3/programs-survey.log`). The `--gates` branch and the run branch were not used: the run branch starts the binary without input, and the gate branch reads the engine's `tests/gates.json`.
- Clean `TARGETS=native scripts/build.sh` and `TARGETS=cart scripts/build.sh`: exit 0, no compiler warnings (`build-native.log`, `build-cart.log`). `build/cart/carts/spike.wasc` 2,698,285 bytes, `spike_stress.wasc` 2,698,527 bytes.
- Native 300 frames with `tests/input-2p.json`: exit 0, `cw.three.missing` 0, player 1 moves independently of player 0 (`state-a.json`, `shot-a.png`). Two runs: whitelisted state (`tests/whitelist.mjs`) and screenshot byte-identical (`determinism.log`). Checksum 3965552069.
- `tests/ordering-check.mjs` (`ordering.log`, `ordering/f*.png`): 18 assertions over six checkpoints, all pass (greater ground-y in front, swapped positions swap it, equal ground-y resolves to the greater id, a jumping actor keeps its ground occlusion in both directions, the pillar occludes an actor behind it and is occluded by one in front). Control, `SPIKE_REVERSE_DEPTH=ON` build (`ordering-reverse.log`, `ordering-reverse/f*.png`): exit 1, 9 assertions fail.
- Control, program row `standard+l1000` removed (`control-norow.log`, `norow-stderr.log`, `shot-norow.png`): exit 0 from `run-cart`, `cw.three.missing` 1 naming `standard+l1000`, the pillar is not drawn, the simulation checksum is unchanged.
- Audio (`audio.log`): `sfx_tick` -1 and `voice_created` 0 at 49 frames; 50 and 1 at 50 frames (the first attack is at input frame 50).
- Cart: romdev (`run-cart --host romdev`) and Chromium (`--host chromium`), 300 frames, same input: whitelisted state byte-equal to native, `cw.three.missing` 0 on both. `wasm{op:conformance}` conforms (one warning, `deterministic-unflagged`, as for `hello`). romdev session `nr-unit3`: `loadMedia` + `host{op:play, seconds:60}` + reload + 59 steps + `frame{op:screenshot}` + `wasm{op:debugState}` (`romdev-*.json`, `romdev-shot.png`); at 60 ticks the whitelisted state equals native's 60-frame state.
- Stress (`spike_stress`, native, 300 frames): `cw.three.missing` 0, 40 actors, one HUD atlas page (`shot-stress.png`).

Findings:

- A bare three.c renderer has no pipeline, so the engine's `cw.three.missing` fields never exist for it (`hello` publishes none, and `tests/gate.mjs` then sees no missing states). The spike publishes both from `t3_renderer_generated_missing`, as `src/render/pipeline.c` does.
- After a render2d pass (the HUD) the next three.c frame loses its depth state unless `t3_renderer_reset_bindings` runs first: without it the ground and pillar are painted over the actors (`out/unit3/noreset.png`). The spike calls it before every 3D render.
- The `input count` whitelist entry is `spike.input_count`, the number of ticks with any action held by either player (the engine's own `input.ticks` and `input.hash` are published as well but are not on the whitelist).
- Native audible check: not run (needs a real audio device; the runners use SDL's dummy driver).

Unverified:

- Audible output of the blip on native and in the browser.
- Native p99 frame time (Unit 6).
- Whether the render-scale-2 (1080p) path costs more than a 960x540 render for this scene (not measured).

## Unit 4: cart build on Darwin

Date: 2026-10-24. Raw logs: `out/unit45/` (gitignored, local to the development host).

The halt condition (the Darwin wasi-sdk refusing the cart SDK's ThinLTO bitcode) did not trigger. The container build path was not needed.

### Toolchain and build

- `deps/wasi-sdk/bin/clang --version`: `clang version 22.1.0-wasi-sdk (https://github.com/llvm/llvm-project 4434dabb69916856b824f68a64b029c67175e532)`, target `wasm32-unknown-wasip1`, thread model posix; the executable is a Mach-O arm64 binary. `wasm-opt version 123 (version_123)` (`toolchain.log`).
- `rm -rf build/cart && TARGETS=cart scripts/build.sh`: exit 0, 24.2 s wall (2 m 30.7 s user), no warning lines (`build-cart-clean.log`).
- `build/cart/carts/spike.wasc`: 2,698,285 bytes, sha256 `c7d1953e3be05c89f91247979d2bfbd953cceda4d3e96ab3a81cc3b60905d26c`. `spike_stress.wasc`: 2,698,527 bytes, sha256 `328bf1fec9e25190d8905e45ba62c17ea3cc096cf18ea9d43f7a856bafaa9112` (`cart-sha-after.log`).
- The Unit 3 build of the same sources has different `.wasc` hashes (`944d5ffe…`, `e02814a1…`; `cart-sha-before.log`) because the zip entries carry their build time. `cart.wasm` inside (6,817,486 bytes, sha256 `3f0a0c1a5a39fda0eaefcbc6b2cb61619e1923a80a0b859bbbd616a8a041a641`) and `manifest.json` are byte-identical across the two builds (`cart-reproducibility.log`).
- Exports of `cart.wasm` (`cart-exports.log`): `memory`, `_initialize`, `wc_alloc`, `wc_free`, `wc_debug_state`, `malloc`, `wc_set_seed`, `wc_get_info`, `wc_init`, `wc_render`, `wc_on_text`, `wasi_thread_start`.

### Conformance

romdev 0.150.2 on `:7331`, session `nr-unit45-conformance`, `loadMedia` (wasmcart, `deterministicSeed` 1, `deterministicStepMs` 16.6667) then `wasm{op:conformance}`:

| Cart | Result | Log |
| --- | --- | --- |
| `spike.wasc` | `conforms: true`, ABI 4, 1920×1080; one warning, `deterministic-unflagged` | `conformance-spike.log` |
| `spike_stress.wasc` | the same | `conformance-spike_stress.log` |
| copy without the `wc_init` export (`games/spike/tests/cart-tools.mjs strip-export`, the export entry removed from the wasm export section) | `conforms: false`, `requiredExportsPresent: false`, issue `missing-export` (severity error): "required export 'wc_init' is not present" | `conformance-control-no-wc_init.log` |
| copy without `wc_render` | `loadMedia` refuses: `Cart must export wc_render`; the conformance op then has no cart (`No ROM loaded`) | `conformance-control-noexport.log` |
| copy without `wc_get_info` | `loadMedia` refuses: `Cart must export wc_get_info` | `conformance-control-no-wc_get_info.log` |
| copy with manifest `width` 640 (cart renders 1920) | `conforms: true`, warning `resolution-mismatch` only; not a failing control | `conformance-control-badres.log` |

The real build in `build/cart/` was not modified; the controls are copies in `out/unit45/`.

### Asset manifest equality

`games/spike/tests/pak-manifest.mjs <native.cwpak> <cart.wasc>` reads the native `.cwpak` (header, index, strings per `deps/cartwheel-engine/src/resource/cwpak.h`; each entry decompressed and its FNV-1a 32 checked against the index hash) and the cart's `assets/` zip entries, normalizes paths (strips `res://` and the cart's `assets/`), and compares sha256 of the uncompressed payloads. Container metadata is not compared: the `.cwpak` header, index offsets, flags and compression, and the zip entries `manifest.json`, `cart.wasm` and `assets/cwfiles.txt` (the lazy-load file list).

- `spike`: 8 assets (`audio/blip.wav`, `fonts/FiraSans-OFL.txt`, `fonts/FiraSans-Regular.ttf`, `res.index`, four `sprites/*.png`), all equal; exit 0 (`pak-manifest-spike.log`). `spike_stress`: the same 8, exit 0 (`pak-manifest-spike_stress.log`). The two native `.cwpak` files are byte-identical (194,993 bytes).
- Every payload also equals the sha256 of its source file under `games/spike/assets/` (`asset-source-sha.log`): the pack keeps sprites, font and audio as they are.
- Control: a copy of `spike.wasc` with one byte of `sprites/blue-left.png` flipped (`cart-tools.mjs tamper-asset`): exit 1, `sprites/blue-left.png: sha256 69c09db4a215… (.cwpak) vs 1a4fa0b88a63… (cart)` (`pak-manifest-control.log`).

## Unit 5: program table and cross-host gates

Date: 2026-10-24. Raw logs: `out/unit45/`. Runner settings are those of ADR-0001 (`CW_TEST_GPU=desktop` for `run-cart.mjs` and the tools below; `CW_TEST_GPU=software CW_WGPU_ADAPTER=apple` for `tests/gate.mjs`).

### Program survey against the cart

- Runs: `spike` and `spike_stress` × `input-2p` (300 frames), `input-ordering` (300), `input-stress` (780) × native (with `CW_PROGRAMS_LOG_DIR`), romdev cart and Chromium cart. Those inputs cover jump (`south`), attack, both players, HUD (always drawn) and the baseline and stress actor counts. 18 of 18 runs exit 0 with `cw.three.missing` 0 (`survey/runs.log`). The native logs are empty. The cart hosts report no program-state log, so the survey takes their `cw.three.missing_states` from the run's state file; none was nonempty (`survey/logs-cart/`, `survey/logs-native/`).
- `node deps/cartwheel-engine/tools/programs.mjs spike spike_stress --no-run --logs <native logs> --logs <cart logs> --build build/native` → `no missing states`, exit 0 (`survey/programs-survey.log`). `--build` is the native tree because it holds `apps/<app>.json` and the capture cache; the cart tree has neither.
- Survey control: the `standard+l1000` text from the row-removed cart's state, fed as a log (`--dry`): `spike: 1`, `1 distinct states over 1 apps` (`survey/programs-survey-control.log`).
- `programs.mjs --table games/spike/programs/spike.txt --build build/native` regenerates `spike_gl.c` and `spike_wgpu.c` with the same sha256 as the committed files (`survey/programs-sha-before.log`, `programs-sha-after.log`, `programs-regen.log`). **The program tables did not change; nothing to recommit.**

### Gates

`tests/gates.json` (`CW_PROJECT_ROOT` honoured by `gate.mjs`): per scenario and cart host, a stock-shaped entry (native is the reference, `fields` is the whitelist plus `spike.checksum`, `tol` 0, the stock control of native one frame early) and two tool gates.

| Entry | App, input, frames | Host pair |
| --- | --- | --- |
| `spike-2p-romdev`, `spike-2p-chromium` | `spike`, `input-2p`, 170 | native vs romdev / Chromium |
| `spike-ordering-romdev`, `spike-ordering-chromium` | `spike`, `input-ordering`, 260 | same |
| `spike-stress-romdev`, `spike-stress-chromium` | `spike_stress`, `input-stress`, 720 | same |
| `spike-p1-romdev`, `spike-p1-chromium` | `spike`, `input-p1` (second pad only), 100 | same |
| `spike-strict` (`games/spike/tests/gate-strict.mjs`) | reads the artifacts of the entries above | |
| `spike-controls` (`games/spike/tests/controls.mjs`) | runs the controls below | |

`TARGETS="native cart" scripts/build.sh` then `node deps/cartwheel-engine/tests/gate.mjs`: exit 0, every entry `ok` (`gate-full.log`): 55 s on the run that built the row-removed cart for `spike-controls`, 36 s with it cached.

The stock comparison does not reject some defects, found by reading `deps/cartwheel-engine/tests/gate.mjs` (not run as a demonstration): a whitelisted field missing or `null` on both sides compares equal; a non-finite or `null` value against a reference `0` compares equal (`Math.abs(0 - null)` is 0); two 0×0 frames give `gt16` NaN, which is not over the bound; the missing-program check reads only the `cw.three.missing_states` text. `spike-strict` therefore rejects a missing or non-finite whitelisted field on either side, a 0×0 or size-mismatched frame, and a nonzero or non-finite `cw.three.missing` on any host. It depends on the artifacts of the strict entries (same `gate.mjs` invocation, which runs entries in file order) and fails with a message when they are absent.

Finding: `run-cart.mjs` writes romdev's state with `f.values ?? f.value`; romdev reports `bytes` fields (`cw.three.missing_states`) as `text`, so on romdev the state file carries the missing-state count but not the names (`romdev-missing-states-field.log`). The count is the authoritative check on romdev.

### Image-tolerance calibration

Method as predeclared. Implementation choices within it: `games/spike/tests/calibrate.mjs` (inputs: the strict entries of `tests/gates.json`; data: `image-calibration.json` in this directory).

- Scenarios and final frames: `spike`/`input-2p` 170, `spike`/`input-ordering` 260, `spike_stress`/`input-stress` 720, `spike`/`input-p1` 100. Each ends with something moving (players, a jump in the air), so a one-frame-early frame differs from the reference. Chosen before the measurement; at frames where all input has ended (300 for `input-2p`) a one-frame-early frame differs only by a tick label and one enemy's step.
- Known-good: native vs host over all 9 pairs of 3 repeated runs per host per scenario; native vs native repeat runs; native vs native with only the HUD `TICK` line changed (the pixels of the 224×48 box at (16, 56) of the next frame pasted into this frame).
- Known-bad: the host's frame replaced by black; the host's frame with sRGB decoded as if linear and, separately, encoded twice (both directions are in the set); the host one frame early, and native one frame early.
- The colour-space and blank frames are the real frames altered in the harness; no build renders in a wrong colour space.

| | native vs romdev | native vs Chromium |
| --- | --- | --- |
| good max `gt16` | 0.000145 (tick-only, `spike_stress` 720) | 0.000145 (the same) |
| host vs native good samples | 0 (pixel-identical), all scenarios | 0, all scenarios |
| bad min `gt16` | 0.001758 (one frame early, `spike` 260) | 0.001758 (the same) |
| bad min by kind | blank 1.0; wrong colour space 0.997758; one frame early 0.001758 | the same |
| tolerance = max(2 × good max = 0.00029, floor 0.0005) | **0.0005** | **0.0005** |
| accepted only if ≤ bad min / 2 = 0.000879 | accepted | accepted |

Per scenario, tick-only `gt16`: 0.000138 (170), 0.000139 (260), 0.000145 (720), 0.000140 (100). One frame early: 0.004343, 0.001758, 0.002935, 0.004195. The tolerance is the floor; the tick-only change (largest good sample) stays under it and under one quarter of the smallest bad sample. Both pairs are in `tests/gates.json` as `maxGt16` 0.0005 with `maxGt16Calibration` pointing at the calibration data.

### Controls

`games/spike/tests/controls.mjs` on the `input-2p` scenario, native as reference, on romdev and Chromium; each check applies the gate's three predicates (image `gt16` against the calibrated bound, exact whitelisted state, `cw.three.missing`) and requires exactly the expected ones to fail (`controls.log`, 25 checks, exit 0; also run by `gate.mjs` as `spike-controls`).

| Control | Origin | Image | State | Missing | Notes |
| --- | --- | --- | --- | --- | --- |
| base | real runs | pass | pass | pass | `gt16` 0 on both hosts |
| row removed (`standard+l1000`) | real: a cart rebuilt with the row removed from manifest and tables (`build-cart-norow`) | fail (`gt16` 0.032, pillar not drawn) | pass | **fail** (`cw.three.missing` = 1; Chromium also names the state) | state gates pass; the image fails too |
| blank frame | real frame replaced | **fail** (`gt16` 1.0) | pass | pass | |
| wrong colour space | real frame recoloured, both directions | **fail** (0.998, 0.998) | pass | pass | |
| 0×0 frame | real frame replaced by a 0×0 PNG | **fail** (rejected before any metric) | pass | pass | |
| non-finite field | real state edited: `null` in `spike.jump`, `"NaN"` in `spike.pos`, `null` `spike.checksum`, `spike.rng` removed, and `null` in the reference's `spike.jump` | pass | **fail** (rejected) | pass | a real NaN cannot be produced without changing the sim |
| input shift | real run: player 1's input one tick late | fail (`gt16` 0.0034) | **fail**, first divergent field `spike.pos` (`spike.pos[3]`: -1.4000 vs -1.3333), then `spike.sfx_tick` 50 vs 51 | pass | |
| tick-counter only (must pass) | native frame with the next frame's `TICK` pixels | **pass** (`gt16` 0.000138) | pass | pass | not an image control |

The stock entries' own control (native one frame early) passes as required on every entry (`gate-full.log`).

### Input mapping (player 1)

`spike-p1-*`: only the second pad acts. romdev sends named ports (`south`, `west`, `left`, ...); Chromium sends pad index 1 as a button mask. Native reference state is pinned by `expect`: `spike.sfx_tick` 30, `spike.voice_created` 1, `spike.input_count` 99, `spike.ticks` 100. All three hosts report player 0 untouched at (-2, 2, 2), player 1 at (1.133, 3.8, 3.804) with a jump height of 1.05 in the air, identical whitelisted state, and `cw.pad1.buttons` 8192 (`left`) with `cw.pad0.buttons` 0 (`p1/summary.log`). The gate entries pass.

### Findings

- romdev's `loadMedia` runs engine frame 1, so an input entry at frame 1 is never applied there. `input-ordering.json` started with a movement entry at frame 1: romdev reached `spike.input_count` 205 against native's 206 at 260 frames, with `spike.pos[0]`, `spike.input_count` and `spike.checksum` different (Chromium equal); `ordering-frame1/summary.log`. The file now begins with a neutral frame-1 entry and the movement entry moved to frame 2 (`input-2p.json` and `input-stress.json` already start neutral). `ordering-check.mjs` on the shifted script: 18 of 18 assertions pass (`ordering-after-shift.log`); the reversed-depth control still fails 9 (`ordering-reverse-after-shift.log`).
- Cross-host pixels: native, romdev and Chromium frames are pixel-identical on this machine in all four scenarios (`gt16` 0, max channel delta 0, romdev vs Chromium included). All three run on the same Apple GPU through the same ANGLE/Metal path; this says nothing about other GPUs.
- No 0×0 frame appeared in any Unit 5 run (the Unit 2 one-off is still unexplained).

### Audible smoke (browser half) and live preview

- Commands for a person to listen (arrows move player 0, Space jumps, J attacks and plays the blip): native, `cd <repo> && CW_GPU=gl build/native/games/spike/spike` (SDL window, default audio driver; the run logs `audio: 48000 Hz, 64 voices, 8 streams`, `native-realaudio-probe.log`); Chromium, `cd <repo> && CW_TEST_GPU=desktop node games/spike/tests/chromium-audio.mjs` (a headed Chromium window; click it once, then press J).
- `games/spike/tests/chromium-audio.mjs --check` (headless): the browser host's audio drain returned only silence over frames 1-60 and a peak sample of 0.3506 after J at frame 60 (`chromium-audio-check.log`); the page rendered the scene (`chromium-audio-page.png`). This shows audio data reaching the browser host, not that it is audible; no one has listened.
- romdev live: one header `x-romdev-session: nr-unit5`; `loadMedia` of `spike_stress.wasc` (`deterministicSeed` 1, `deterministicStepMs` 16.6667) then `host{op:play, seconds:60}` at 2026-10-24T22:11:26Z, response `playing: true, fps: 60, endsAt 22:12:26.776Z` (`romdev-live-load.json`, `romdev-live-play.json`). The scene was not observed on `/livestream` by the author of this section.

### Unverified

- Audible output of the blip, native and in Chromium (commands above; nobody has listened).
- A real (not edited) NaN in a whitelisted field, a blank frame from a host and a wrong-colour-space render: those controls alter the artifacts of real runs.
- The stock `gate.mjs` gaps listed above were read from source, not exercised.
- Image agreement on any GPU other than the Apple M1 Pro; the calibration has no spread to measure because all hosts agree exactly.
- Whether the romdev livestream showed the stress scene.
