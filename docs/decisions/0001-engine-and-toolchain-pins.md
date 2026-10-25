# ADR-0001: Engine and toolchain pins

## Status

Accepted and final, 2026-10-24. Amended by the Unit 4 and Unit 6 outcomes and by the combat-slice Unit 1 pins (see Amendments).

## Context

Neon Rebellion builds on Cartwheel (C, three.c rendering, wasmcart carts) from one source tree: a native macOS arm64 binary and a `.wasc` cart. The engine, its three.c fork, the wasmcart hosts, the cart toolchain and the romdev host move independently, and the engine's own lock pins the cart toolchain as `x86_64-linux` builds only. The project needs one reviewable record of exactly which versions it builds and tests against, and a toolchain that runs on the development Mac.

Plan: `docs/plans/2026-10-24-001-feat-shipping-path-spike-plan.md`.

## Decision

- The project is out-of-tree: it builds against prebuilt Cartwheel SDKs with `find_package(cartwheel CONFIG)`; there is no engine fork.
- `scripts/deps.lock` is the only hand-edited source of pins. `scripts/fetch-deps.sh` installs from it and refuses any archive whose sha256 differs or is absent. `scripts/preflight.sh` writes `build/tuple.json` from it plus the observed host. The table below is generated from it (`node scripts/gen-pins-table.mjs --update docs/decisions/0001-engine-and-toolchain-pins.md`; `--check` fails when it is stale).
- Engine: `monteslu/cartwheel-engine` tag `v0.15.1`. The tag is annotated; the pinned commit is the peeled one (`git ls-remote --tags` ref `refs/tags/v0.15.1^{}`). The tag object is `c53bddcd5260beca62f1cd14aa9f8c456438466b`.
- SDKs: `macos-arm64` (Darwin-executable: static libraries, `bin/cwpack`, `tools/programs.mjs`) and `cart` (target-only `wasm32-wasip1-threads` libraries as ThinLTO bitcode, wasmcart-pack, import checker). sha256 values are the release's `.sha256` assets and equal the GitHub release asset digests.
- Cart toolchain: wasi-sdk 33.0 and Binaryen 123, both `arm64-macos` builds, installed into `deps/` and linked into `deps/cartwheel-sdk/cart/deps/` where the SDK's `cmake/cart.cmake` and `cmake/flags.cmake` look. The cart SDK's own `scripts/fetch-deps.sh` is not used: it pins the `x86_64-linux` builds.
  - wasi-sdk digest: the GitHub release asset digest of `wasi-sdk-33.0-arm64-macos.tar.gz` (release `wasi-sdk-33`). The release publishes no checksum asset; this is the only upstream source of the digest.
  - Binaryen digest: the release's `binaryen-version_123-arm64-macos.tar.gz.sha256` asset.
- Dual-cart SDK: `cart-wgpu` (the `cart` libraries plus `emdawnwebgpu` and `wasmcart-wgpu`), built into `build/cart-wgpu`; the GL-only `cart` SDK and `build/cart` stay. Its sha256 is the GitHub release asset digest (`gh release view v0.15.1 -R monteslu/cartwheel-engine --json assets`).
- Blender 4.5.15 LTS (macOS arm64 `.dmg`) renders the sprite atlases (`tools/render`, ADR-0002). `scripts/fetch-deps.sh` verifies the `.dmg` sha256 (from `download.blender.org/release/Blender4.5/blender-4.5.15.sha256`), mounts it read-only, copies `Blender.app` into `deps/blender` and detaches it.
- three.c and wasmcart are pinned as the engine's `scripts/deps.lock` pins them at `v0.15.1`; `fetch-deps.sh` aborts if the engine's lock disagrees with ours. `wasmcart-wgpu` is the engine's separate pin for the WebGPU tier's hosts (`deps/cartwheel-engine/deps/wasmcart-wgpu`), checked the same way; at `v0.15.1` it names the same commit as `wasmcart`. The engine source checkout carries `tools/`, `tests/`, three.c's generator tools and wasmcart's Node hosts (Playwright Chromium).
- romdev is an observed host entry, not an installed dependency.
- `TARGETS="native cart cart-wgpu" scripts/build.sh` configures one Ninja tree per target (`build/native`, `build/cart`, `build/cart-wgpu`) against the matching SDK; the default is `native cart`.

### Pins

<!-- pins:begin -->
| Name | Version | Source | Pin |
| --- | --- | --- | --- |
| `cartwheel-engine` | v0.15.1 | https://github.com/monteslu/cartwheel-engine.git | commit `4a5f73e8542b0069dc0689d026fd73c399a13907` |
| `cartwheel-sdk:macos-arm64` | v0.15.1 | https://github.com/monteslu/cartwheel-engine/releases/download/v0.15.1/cartwheel-sdk-0.15.1-macos-arm64.tar.gz | sha256 `7615869aa000b97dd37a54964b358e28a1ebbc7a5c1290a342840257424df047` |
| `cartwheel-sdk:cart` | v0.15.1 | https://github.com/monteslu/cartwheel-engine/releases/download/v0.15.1/cartwheel-sdk-0.15.1-cart.tar.gz | sha256 `00780dcbed82517aea76784c64a91415ca913d7af6fd39966b5c5de7843d950b` |
| `cartwheel-sdk:cart-wgpu` | v0.15.1 | https://github.com/monteslu/cartwheel-engine/releases/download/v0.15.1/cartwheel-sdk-0.15.1-cart-wgpu.tar.gz | sha256 `777167301a0afaf515ef78e1ca3514ceac3ff9f1c3eade7d92ced36e8d57d4a7` |
| `three.c` | main | https://github.com/monteslu/three.c.git | commit `c5f840b62dd398a3cc59d4863065ce8029e2cae1` |
| `wasmcart` | v0.34.3 | https://github.com/wasmcart/wasmcart.git | commit `cd233ea13c5656634898a925c214e3aea0558884` |
| `wasmcart-wgpu` | v0.34.3 | https://github.com/wasmcart/wasmcart.git | commit `cd233ea13c5656634898a925c214e3aea0558884` |
| `wasi-sdk:darwin-arm64` | 33.0 | https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-33/wasi-sdk-33.0-arm64-macos.tar.gz | sha256 `85c997a2665ead91673b5bb88b7d0df3fc8900df3bfa244f720d478187bbdc78` |
| `binaryen:darwin-arm64` | 123 | https://github.com/WebAssembly/binaryen/releases/download/version_123/binaryen-version_123-arm64-macos.tar.gz | sha256 `74428be348c1a09863e7b642a1fa948cabf8ec9561052233d8288e941951725b` |
| `blender:macos-arm64` | 4.5.15 | https://download.blender.org/release/Blender4.5/blender-4.5.15-macos-arm64.dmg | sha256 `bfbc0bda099d1ab7aef0992a584f872f58bed9bb491210ad45f9ca071aa2e688` |
| `observed:romdev` | 0.150.2 | http://localhost:7331 | observed |
<!-- pins:end -->

### Darwin launch settings for the engine runners

Measured on macOS 15.7.9 arm64, Apple clang 17.0.0, node 24.22.1. Evidence: `docs/evidence/shipping-path-spike/README.md`.

- `tools/run-cart.mjs` (`native`, `chromium`, `romdev`): `CW_PROJECT_ROOT=<project root>` and `CW_TEST_GPU=desktop`. Without `CW_TEST_GPU`, it exits 1 in `enterGpuSandbox()` (the Linux test-GPU pin reads `~/.config/cartwheel/chromium-gpu` and sysfs).
- `tests/gate.mjs`: `CW_PROJECT_ROOT=<project root>`, `CW_TEST_GPU=software` and `CW_WGPU_ADAPTER=apple`. `armGuard()` calls the test-GPU lookup before honouring `CW_TEST_GPU=desktop`, so `desktop` still exits 1; `software` selects the no-op guard, and its GL renderer check then expects a renderer name containing `CW_WGPU_ADAPTER` (the native build reports `ANGLE (Apple, Apple M1 Pro, OpenGL 4.1 Metal - 89.4)`). The renderer is the real Metal GPU; the setting name is the engine's.
- No project-owned adapter was needed for either runner.
- `run-cart.mjs --host romdev` talks to `127.0.0.1:7331` (hard-coded) and opens its own `cartwheel-run-<app>-<pid>` session.

## Consequences

- Upgrading any component is a lock change followed by rerunning the gates; the table and `tuple.json` follow the lock.
- The Darwin-built cart toolchain is the primary path. Whether the `arm64-macos` wasi-sdk links every cart the project builds is recorded in the Amendments.
- The stock romdev install (`romdevtools` 0.150.2, mise) ships Linux x86-64 `native-gles` binaries (`gles.node` is an ELF file), so `loadMedia` of any wasmcart GL cart fails there with `webgl-node/native-gles failed to load`. A romdev-dependent step needs a repaired install (the repair that worked in a copy: `node scripts/download-release.mjs` inside `node_modules/webgl-node/node_modules/native-gles`, which fetches `gles.node-v0.7.1-darwin-arm64.tar.gz`). The server on `:7331` loads GL carts (the Unit 3 and Unit 5 runs used it). `scripts/preflight.sh` records `romdev.gl_module_loads` in `tuple.json`.
- The romdev host carries wasmcart 0.34.5 (its `node_modules/wasmcart`), not the pinned 0.34.3; both report cart ABI 4. `tuple.json` records the installed version as `romdev.wasmcart_runtime_version`; the host does not report it over HTTP.
- Docker is not a build dependency of the primary path. Its client is present on the development host; the daemon was not running when preflight ran.

## Amendments

- **2026-10-24, Unit 4: the Darwin cart toolchain builds the spike.** The Darwin `arm64-macos` wasi-sdk 33.0 (`clang version 22.1.0-wasi-sdk`, llvm-project `4434dabb69916856b824f68a64b029c67175e532`, target `wasm32-unknown-wasip1`) linked the cart SDK's ThinLTO bitcode for `spike` and `spike_stress` using Binaryen 123 from `deps/` and the SDKs and digests in the table above. A clean `TARGETS=cart scripts/build.sh` took 24.2 s and exited 0 with no warnings; `spike.wasc` is 2,698,285 bytes, sha256 `c7d1953e3be05c89f91247979d2bfbd953cceda4d3e96ab3a81cc3b60905d26c`; its `cart.wasm` is byte-identical to the Unit 3 build's. romdev `wasm{op:conformance}` passes on both carts (ABI 4, one `deterministic-unflagged` warning); a copy without `wc_init` fails it, and copies without `wc_render` or `wc_get_info` are refused at load. The native `.cwpak` and the cart's embedded assets carry the same 8 payloads (equal sha256). The `linux/amd64` container build path is not needed. Evidence and logs: `docs/evidence/shipping-path-spike/README.md`, Unit 4.
- **2026-10-24, Unit 6: the pins are final for the shipping-path spike.** The pinned tuple above built and ran the spike on all three hosts with no change to the lock. Measured on it (details and raw numbers in `docs/evidence/shipping-path-spike/README.md`, Unit 6): native frame time at 40 actors p99 0.937 ms worst of 10 runs against the 16.6 ms budget, vsync off, on a one-pixel-readback build (a 0.5 ms-per-actor busy-loop control reaches 22-23 ms and fails the budget as required); cart hosts recorded only (romdev, headless Chromium); whitelisted state and checksum byte-equal on native, romdev and Chromium; `gate.mjs` green. Host facts recorded by the session script `games/spike/tests/romdev-session.mjs`: romdev 0.150.2 serves `/openapi.json` and `/tool/{name}/schema`, and the script stops on any drift from the shapes it relies on; `wasm{op:command}` advances one frame; the load runs engine frame 1. `playtest{op:open}` on this romdev install fails with `Couldn't open the SDL playtest window: log is not a function` (reported in romdev's local feedback log), so the interactive window is unavailable on the pinned host; headless romdev is unaffected. The measurement switches `SPIKE_PERF`, `SPIKE_PERF_CONTROL` and `SPIKE_NO_PREWARM` are off in the default build, which is byte-identical to the Unit 4 cart.
- **2026-10-24, combat-slice Unit 1: dual-cart SDK and Blender pinned.** The lock gained `cartwheel-sdk:cart-wgpu` (v0.15.1, sha256 `777167301a0afaf515ef78e1ca3514ceac3ff9f1c3eade7d92ced36e8d57d4a7`, equal to the release asset digest), `wasmcart-wgpu` (v0.34.3, commit `cd233ea13c5656634898a925c214e3aea0558884`, equal to the engine lock's) and `blender:macos-arm64` (4.5.15, `blender-4.5.15-macos-arm64.dmg`, sha256 `bfbc0bda099d1ab7aef0992a584f872f58bed9bb491210ad45f9ca071aa2e688`, the line of Blender's published `blender-4.5.15.sha256`; `Blender --version` reports build hash `5afeabba6097`). `TARGETS="native cart cart-wgpu" scripts/build.sh` built `games/spike` and `games/litspike` into all three trees (`build/cart` wasc sizes unchanged: `spike.wasc` 2,698,285 bytes; the dual cart's `spike.wasc` is 2,815,083 and `litspike.wasc` 2,494,692 against 2,375,684). The spike gates (`gate.mjs`, all ten entries) stayed green on `build/cart`. On romdev 0.150.2 with the native-dawn repair, the dual `litspike.wasc` passes `wasm{op:conformance}`; `loadMedia{wgpu:true}` reports `gpu: "webgpu"` (Apple M1 Pro, Metal) and the cart then reports `cw.gpu.api` 2, `cw.gpu.errors` 0, `cw.three.missing` 0; `wgpu:false` runs the same cart on GL (`cw.gpu.api` 1). `scripts/preflight.sh` records `installed.sdk_cart_wgpu`, `installed.blender` and `romdev.webgpu_module_loads`. `npm ci` for `wasmcart-wgpu` blocks the install scripts of `native-dawn`, `native-gles` and `@kmamal/sdl` (npm's allowScripts); nothing run in Unit 1 loads those packages from `deps/cartwheel-engine/deps/wasmcart-wgpu`.
