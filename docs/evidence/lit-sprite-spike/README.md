# Lit sprite spike: normal-mapped, alpha-tested sprite planes under moving coloured point lights

Question (`docs/brainstorms/2026-10-24-combat-slice-requirements.md`, R3, R4, R7, AE5): can three.c render an alpha-tested sprite plane with a colour map and a normal map, lit by moving coloured point lights, on the GL and WebGPU paths, with zero missing program states?

Date: 2026-10-24. Repo HEAD 2e9426c. Engine `cartwheel-engine` v0.15.1 (4a5f73e), three.c 0.186.18 (c5f840b), SDK 0.15.1. Machine: Apple M1 Pro, macOS 15.7.9; GL is ANGLE on Metal (`ANGLE (Apple, Apple M1 Pro, OpenGL 4.1 Metal - 89.4)`), WebGPU is Dawn on Metal (`apple Apple M1 Pro (106b:0000, metal-3)`) natively and Chromium's WebGPU (`apple metal-3`, `featureLevel: compatibility`) in the browser.

## Verdict

| Path | Verdict | Where it was proven |
| --- | --- | --- |
| GL | **GO** | native GL, GL cart in headless Chromium (WebGL2), GL cart in romdev: all three agree to within 1/255 per channel |
| WebGPU | **GO**, with a pin change | native WebGPU (Dawn), dual cart in headless Chromium WebGPU and in romdev (after the native-dawn repair, below): `cw.gpu.api` 2, `cw.gpu.errors` 0, `cw.three.missing` 0, all three pixel-identical at frame 120 (`shots/stress-wgpu-romdev-f120.png`). The project pins the GL-only `cart` SDK; the dual cart needs the `cart-wgpu` SDK (not pinned). |

No path needed the normal map dropped. `cw.three.missing` is 0 on every host, every frame.

### `cw.three.missing` per host

| Host | API | f60 | f120 | f180 | f240 |
| --- | --- | --- | --- | --- | --- |
| native | GL (`cw.gpu.api` 1) | 0 | 0 | 0 | 0 |
| Chromium cart (`build/cart`) | GL | 0 | 0 | 0 | 0 |
| romdev cart (`build/cart`) | GL | 0 | 0 | 0 | 0 |
| native | WebGPU (`cw.gpu.api` 2) | 0 | 0 | 0 | 0 |
| Chromium dual cart | WebGPU (`cw.gpu.api` 2) | 0 | 0 | 0 | 0 |
| romdev dual cart, `wgpu:true` | **GL** (`cw.gpu.api` 1): see Blockers | 0 (f60 only) | | | |

The 40-actor app (`litspike_stress`, frame 120) also reports 0 on native GL, Chromium GL, native WebGPU and Chromium WebGPU (`states/stress-*`). `cw.three.missing_states` is empty throughout.

Simulation checksum (`lit.checksum`) per frame, identical on all five hosts: f60 140963885, f120 1226065879, f180 87545007, f240 1474164980 (`logs/checksums.log`). Light motion uses `cw_sincos`, so it is bit-identical across wasm and native.

## What was built

`games/litspike/` (copied from `games/spike/`; `games/spike` untouched; the one edit outside it is `add_subdirectory(games/litspike)` in the root `CMakeLists.txt`).

- `tools/gen-lit-placeholders.mjs`: a 64x128 figure (capsule body, spherical head, visor, belt, buckle; alpha 0/255, no baked lighting) and its tangent-space normal map (dome profile per shape, height-field union, `(128,128,255)` outside the figure). Stored-deflate PNGs; two runs give identical sha256 (`figure.png` f1d659c1…, `figure-n.png` 73325ece…).
- `main.c`: ground plane (`MeshStandardMaterial`), one `MeshStandardMaterial` pillar, three actor planes sharing one `MeshStandardMaterial` (`map` + `normalMap` + `alphaTest 0.5`, metalness 0, roughness 1, `normalScale (1,1)`, map sRGB, normal map `NoColorSpace`, both `T3_NEAREST`, mipmaps off), ambient `0x303844` x 1.0, three `t3_point_light_new(color, 36, 16, 2)` lights (magenta `0xff2bd6`, cyan `0x20e8ff`, amber `0xffa020`) sweeping along x with periods 120/240/360 ticks. Camera as in spike. Fixed 60 Hz tick, no input, no HUD, no audio. Debug fields `lit.pos`, `lit.light_pos`, `lit.actors`, `lit.lights`, `lit.ticks`, `lit.checksum`, `cw.three.missing`, `cw.three.missing_states`.
- `LITSPIKE_ACTORS` compile definition: `litspike` draws 3 actors, `litspike_stress` 40 (4 rows of 10, auto-instanced into one draw).
- `LITSPIKE_FLAT_NORMALS` control build (flat `(0,0,1)` normal map, same program state) and `LITSPIKE_PERF` measurement build.

### Program states added

`games/litspike/programs/litspike.txt`, generated tables `litspike_gl.c` (2 states, 33 KB) and `litspike_wgpu.c` (2 states, 34 KB):

```
standard+map+nearest+instbig+nmap+atest+l0300
standard+l0300
```

Survey: `run-cart.mjs --host native` on `litspike` and `litspike_stress` with `CW_PROGRAMS_LOG_DIR`, then `programs.mjs litspike litspike_stress --no-run --logs … --build build/native` (`logs/programs-survey.log`, `logs/proglogs/`). With an empty table both draws are skipped on native too and the frame is the clear colour (`cw.three.missing` 2). The `instbig` state is the auto-instanced batch (three or forty actors share geometry and material); the non-batched `standard+map+nearest+nmap+atest+l0300` is not reached by either app and is not in the table. Adding a second actor material that does not batch would need it. Capture counts: GL 5 bindings, WebGPU 7 bindings for the actor state, well under the 16-texture limit.

Row-removal control (`logs/lit-side-check-ctl-missing-row.log`): a build whose table lacks the actor row reports `cw.three.missing 1` with `standard+map+nearest+instbig+nmap+atest+l0300`, draws no actor on native and in the cart (body luminance 19.7 = clear colour, one colour), and the check below fails on every frame. `shots/ctl-native-f60.png`.

## Lit side follows the light

`tests/lit-side-check.mjs` projects the middle actor's sprite through spike's camera, averages luminance over a strip on the body's left flank and one on its right (texels x 12-20 and 44-52, rows 60-66), and takes D = left - right. `push` is `sum_i lum_i (x_actor - x_light_i) / d_i^3` from the state's `lit.light_pos`: a light left of the actor gives positive push. Checks: sign(D) = sign(push) wherever |push| >= 0.02; D changes sign across the four frames; the body is not dark and not one colour; `cw.three.missing` is 0; and the normal-mapped mean |D| is at least 2x the flat-normal control's.

| Frame | left | right | D | push | flat-normal control D |
| --- | --- | --- | --- | --- | --- |
| 60 | 201.2 | 150.6 | +50.6 | +0.0786 | +11.2 |
| 120 | 32.0 | 172.8 | -140.8 | -0.0754 | -24.9 |
| 180 | 208.8 | 78.2 | +130.7 | +0.0868 | +33.3 |
| 240 | 109.4 | 197.8 | -88.4 | -0.0784 | -24.7 |

Mean |D| 102.6 normal-mapped against 23.5 flat: ratio 4.36. The table above is native GL; Chromium GL and romdev give the same numbers to the printed digit; native WebGPU and Chromium WebGPU differ by at most 0.1 (f180 D +130.6). All four hosts pass every check (`logs/lit-side-check-gl.log`, `…-romdev.log`, `…-wgpu.log`, `…-wgpu-native-flat.log`). The flat control also changes sign with the light (a flat plane is lit unevenly by a point light), which is why the pass criterion is the 4x amplitude over the control and not the sign alone.

Screenshots kept (1920x1080): `shots/native-f{60,120,180,240}.png` (GL), `shots/wgpu-native-f{60,120,180,240}.png` (WebGPU), `shots/romdev-f120.png`, `shots/flat-native-f120.png` (flat-normal control), `shots/ctl-native-f60.png` (row-removal control), `shots/stress-native-f120.png` (40 actors). Chromium GL frames are pixel-identical to native GL and Chromium WebGPU frames to native WebGPU (host comparison below), so they are not kept; romdev frames differ from native by at most one channel level, so only f120 is kept.

### Host comparison (`tests/pixel-diff.mjs`, `logs/pixel-diff.log`; 2073600 pixels, engine `diffImages`/`diffAreas`)

| Pair | Differing pixels (any channel) | Max channel delta | pixels > 2 | 7x7 blocks over 35 luma |
| --- | --- | --- | --- | --- |
| native GL vs Chromium GL | 0 | 0 | 0 | 0 |
| native GL vs romdev GL | 0.0018-0.0027 % | 1 | 0 | 0 |
| native WebGPU vs Chromium WebGPU | 0 | 0 | 0 | 0 |
| any GL vs any WebGPU | 1.19-1.38 % | 1 | 0 | 0 |

Same on all four frames. Every difference is one level in one channel.

## Performance (native GL, `tests/perf-native.mjs`)

Five runs per app, CW_FRAMES 721 on the flat-out loop, 120 warm-up and 600 measured frames, `LITSPIKE_PERF` build (one-pixel `glReadPixels` after each frame, so every frame includes its GPU work; the `done` series). Medians over the five runs' per-run statistics, worst run in parentheses. Budget 16.6 ms. GL only: the readback is `glReadPixels`.

| Lit actors | p50 (ms) | p99 (ms) | max, worst run (ms) | `cw.three.missing` |
| --- | --- | --- | --- | --- |
| 3 | 1.03 | 1.18 (1.45) | 3.03 | 0 x 5 |
| 40 | 1.19 | 1.46 (1.56) | 2.30 | 0 x 5 |

The three-actor p50 is bimodal across runs (0.51, 0.51, 1.03, 1.06, 1.06 ms), a machine-state effect, not the scene. The 40 actors fill four rows of ten at 1.4 world units, overlapping in depth, the outer actors of the front row touching the frame edge, sharing one instanced draw; three point lights and the ground and pillar are drawn in every frame. Raw runs: `perf/`, `logs/perf-litspike*.log`. Not measured: WebGPU frame time, cart frame time.

## romdev (session `nr-litspike`, romdev 0.150.2)

`tests/romdev-session.mjs`, one `x-romdev-session: nr-litspike` header on every call (`romdev/calls.ndjson`, `logs/romdev-session.log`):

1. `loadMedia` of `build/cart/carts/litspike.wasc` (`deterministicStepMs 16.6667`, `deterministicSeed 1`; `gpu: gl`, 1920x1080), then `host{play, seconds: 60}` for the `/livestream`, no other call while it played.
2. `loadMedia` again, `wasm{conformance}` (conforms, ABI 4, warning `deterministic-unflagged`), `frame{step}` to frames 60/120/180/240 asserting `lit.ticks` equals the frame count each time, then `frame{screenshot}` and `wasm{debugState}` (`shots/romdev-f*.png`, `states/romdev-f*.json`). `cw.three.missing` 0 and checksums equal to native at every frame.
3. `loadMedia` of the dual cart with `wgpu:true`: see Blockers.

No native window and no headed Chromium were opened.

## three.c facts confirmed from source

All paths under `deps/cartwheel-engine/deps/three.c/` (c5f840b).

- Normal maps on Standard: `t3_material` has `normal_map` and `normal_scale` (`include/three.h:430-431`); `t3_material_set_texture(m, T3_NORMAL_MAP, t)` (`include/three.h:502`, `src/core.c:400`). The state key adds `nmap` when a normal map is set, and `tan` only when the geometry has a `T3_ATTR_TANGENT` attribute (`src/renderer_gen.inc:156`).
- `t3_plane_geometry_new` emits position, normal `(0,0,1)` and uv only, no tangent attribute (`src/geometry.c:282-292`; the only tangent code is the transform in `src/geometry.c:724`). The planes here therefore ran the `nmap` (no `tan`) program, which r186 builds with a derivative-based tangent frame; no tangent generation was needed, and the normal map reads as rounded on every host. `T3_ATTR_TANGENT` is a header slot (`include/three.h:325`) with no generator in `include/three.h`.
- Alpha test: `m->alpha_test > 0` adds `atest` (`src/renderer_gen.inc:202`; field `include/three.h:435`). Map filtering: `nearest` is added from the colour map's filters only (`src/renderer_gen.inc:188`); the normal map's filters are not part of the state key.
- Lights: `t3_point_light_new(color, intensity, distance, decay)` (`include/three.h:745`). The renderer takes at most 8 lights per type, extras ignored (`src/renderer.c:109`, `:1462`). The state's light vector is `lDPSH` counts (`docs/r186-renderer.md:74-75`); with no exact vector a captured program whose counts cover the scene's is used and unused slots stay empty (`docs/r186-renderer.md:276-281`, `src/renderer_gen.inc:228-232`). A scene whose point-light count changes at run time needs a state per count or a covering one.
- Standard material kinds available: Standard, Physical, Lambert, Phong, Basic, Normal (`include/three.h:396-399`, `src/renderer_gen.inc:111-122`). `t3_mesh_standard_material_new` (`include/three.h:497`).
- Project tables: states come from `t3_renderer_generated_missing` and are generated with `tools/gen-project-table.mjs` or the engine's `programs.mjs` (`docs/r186-renderer.md:86-117`); an SDK build has no run-time builder (`CW_THREE_BUILDER OFF` in the SDK's `cartwheelConfig.cmake`).
- Auto-instancing: identical geometry + material meshes batch and take the `instbig` state, and the normal map works through it (40-actor scene).

## Blockers and findings

1. **The pinned `cart` SDK is GL-only.** `deps/cartwheel-sdk/cart/manifest.json` has `"wgpu": false` and `cart-sdk-info.cmake` `CW_SDK_WGPU OFF`; the dual (GL + WebGPU) cart comes from the separate `cartwheel-sdk-0.15.1-cart-wgpu.tar.gz` release asset (sha256 `777167301a0afaf515ef78e1ca3514ceac3ff9f1c3eade7d92ced36e8d57d4a7`, verified against the release's `.sha256`), which carries `emdawnwebgpu` and `wasmcart-wgpu`. It was fetched to `out/litspike/wgpu-probe/sdk` (untracked) with the Darwin wasi-sdk/Binaryen linked in the way `scripts/fetch-deps.sh` links them, and built to `out/litspike/build-cart-wgpu/carts/litspike.wasc` (2.49 MB against 2.38 MB for the GL cart) in 20 s. `scripts/deps.lock` and `scripts/fetch-deps.sh` were not changed; pinning it is a lock change that needs the owner's approval.
2. **`run-cart.mjs --gpu webgpu` cannot run on macOS.** `tools/lib/wgpu-pin.mjs:62` throws `GPU test runs need the test GPU in ~/.config/cartwheel/chromium-gpu (a PCI address…)`: the pin is read from Linux sysfs. Native WebGPU is therefore launched directly (`capture-hosts.mjs --gpu webgpu`: `CW_GPU=webgpu`, `SDL_VIDEODRIVER=offscreen`, no display) and the browser leg uses `tests/chromium-wgpu.mjs`, which follows `run-cart.mjs`'s Chromium host with `deps/wasmcart` (wasmcart 0.34.3) as the cart host and fails the run unless the cart reports `usesWgpu` and `cw.gpu.api` 2.
3. **A stock romdev 0.150.2 install cannot run a WebGPU cart on macOS.** `loadMedia{wgpu:true}` on the dual cart returns `gpu: "gl"` and `hasWgpuRendering: false`; the cart then reports `cw.gpu.api` 1 (`romdev/calls.ndjson`, `romdev/romdev-dual-wgpu-request-f60.json`). Cause: `import('webgpu-node')` fails because `node_modules/native-dawn/dist/` is absent. Repair (recorded in `docs/solutions/integration-issues/romdev-gles-node-linux-binary-on-macos-2026-10-24.md`, reported in monteslu/romdev#14): `node scripts/install.mjs` inside `node_modules/native-dawn`, then restart the server. After the repair, `loadMedia{wgpu:true}` reports `gpu: "webgpu"` on the Apple M1 Pro Metal adapter, the stress cart reports `cw.gpu.api` 2 and `cw.three.missing` 0 at frame 60, and frame 120 is pixel-identical to native WebGPU (`out/litspike/romdev-wgpu-load.json`, `romdev-wgpu-debug.json`).

## Reproduce

```sh
node games/litspike/tools/gen-lit-placeholders.mjs
TARGETS="native cart" scripts/build.sh
games/litspike/tests/build-variant.sh out/litspike/build-flat native -DLITSPIKE_FLAT_NORMALS=ON   # and cart
games/litspike/tests/build-variant.sh out/litspike/build-perf native -DLITSPIKE_PERF=ON
# dual cart: <cart-wgpu SDK>/cmake/cart.cmake as toolchain, -Dcartwheel_DIR=<cart-wgpu SDK>/lib/cmake/cartwheel, -DCW_CWPACK=deps/cartwheel-sdk/macos-arm64/bin/cwpack
export CW_TEST_GPU=desktop
node games/litspike/tests/capture-hosts.mjs                                  # native + Chromium, GL
node games/litspike/tests/capture-hosts.mjs --gpu webgpu --prefix wgpu-      # native Dawn + Chromium WebGPU
node games/litspike/tests/lit-side-check.mjs --flat-prefix flat-
node games/litspike/tests/perf-native.mjs --app litspike_stress
node games/litspike/tests/romdev-session.mjs
```

## Unverified

- WebGPU frame time and cart frame time (perf readback is GL only; the task asked for native GL numbers).
- That the normal map is sampled nearest in the generated programs: the state key ignores its filter (`src/renderer_gen.inc:188`). Indirect evidence only: GL and WebGPU frames differ by at most one level, and a linear and a nearest sampler would differ more at texel edges.
- Alpha-edge fringing: the sprite's alpha is 0/255 with nearest filtering and no mipmaps, so a fringe cannot occur here; art with partial alpha or mipmaps was not tried (R7's "no alpha fringing" item is untested on real art).
- Specular response (roughness fixed at 1, metalness 0), shadows, a runtime change in light count, `normalScale` other than (1,1), tangent-attribute geometry.
- Other GPUs and operating systems: everything ran on one M1 Pro (ANGLE/Metal for GL, Dawn/Metal and Chromium WebGPU compatibility mode for WebGPU).
- `cart.wasm` determinism across rebuilds for litspike (checked for spike only).
