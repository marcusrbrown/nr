# ADR-0001: Engine and toolchain pins

## Status

Accepted, 2026-10-24. Amended by the Unit 4 outcome (see Amendments).

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
- three.c and wasmcart are pinned as the engine's `scripts/deps.lock` pins them at `v0.15.1`; `fetch-deps.sh` aborts if the engine's lock disagrees with ours. The engine source checkout carries `tools/`, `tests/`, three.c's generator tools and wasmcart's Node hosts (Playwright Chromium).
- romdev is an observed host entry, not an installed dependency.
- `TARGETS="native cart" scripts/build.sh` configures one Ninja tree per target (`build/native`, `build/cart`) against the matching SDK.

### Pins

<!-- pins:begin -->
| Name | Version | Source | Pin |
| --- | --- | --- | --- |
| `cartwheel-engine` | v0.15.1 | https://github.com/monteslu/cartwheel-engine.git | commit `4a5f73e8542b0069dc0689d026fd73c399a13907` |
| `cartwheel-sdk:macos-arm64` | v0.15.1 | https://github.com/monteslu/cartwheel-engine/releases/download/v0.15.1/cartwheel-sdk-0.15.1-macos-arm64.tar.gz | sha256 `7615869aa000b97dd37a54964b358e28a1ebbc7a5c1290a342840257424df047` |
| `cartwheel-sdk:cart` | v0.15.1 | https://github.com/monteslu/cartwheel-engine/releases/download/v0.15.1/cartwheel-sdk-0.15.1-cart.tar.gz | sha256 `00780dcbed82517aea76784c64a91415ca913d7af6fd39966b5c5de7843d950b` |
| `three.c` | main | https://github.com/monteslu/three.c.git | commit `c5f840b62dd398a3cc59d4863065ce8029e2cae1` |
| `wasmcart` | v0.34.3 | https://github.com/wasmcart/wasmcart.git | commit `cd233ea13c5656634898a925c214e3aea0558884` |
| `wasi-sdk:darwin-arm64` | 33.0 | https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-33/wasi-sdk-33.0-arm64-macos.tar.gz | sha256 `85c997a2665ead91673b5bb88b7d0df3fc8900df3bfa244f720d478187bbdc78` |
| `binaryen:darwin-arm64` | 123 | https://github.com/WebAssembly/binaryen/releases/download/version_123/binaryen-version_123-arm64-macos.tar.gz | sha256 `74428be348c1a09863e7b642a1fa948cabf8ec9561052233d8288e941951725b` |
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
