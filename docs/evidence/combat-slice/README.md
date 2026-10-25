# Combat slice evidence

Plan: `docs/plans/2026-10-24-002-feat-combat-slice-plan.md`. Decisions: `docs/decisions/0002-render-pipeline-and-look.md`.
Origin and the two gates: `docs/brainstorms/2026-10-24-combat-slice-requirements.md`. Per-unit artifacts sit in `unit2/`,
`unit3/` and so on; the Unit 8 artifacts are `gates/`, `controls/`, `perf/`, `romdev/`, `look/` and `image-calibration.*`.
Everything below was measured on one machine: Apple M1 Pro (ANGLE on Metal for GL, Dawn on Metal for WebGPU), macOS 15.7.9,
romdev 0.150.2, headless Chromium from the engine's harness, HEAD 41ddfe3 plus the Unit 8 commits; Round 2 (below) was measured on 600cf0a plus its own commits.

## Verdicts

| Gate | Verdict | Evidence |
| --- | --- | --- |
| Brawler gate | **met** | 10 stock entries of `tests/gates.json` (5 scripts x romdev GL, Chromium GL) and `nr-strict` pass under the engine's `gate.mjs`; `nr-wgpu` (Chromium WebGPU, romdev WebGPU against native WebGPU, 5 scripts) and `nr-controls` (56 controls) pass as tool gates; native p99 at the wave-4 count is 1.16 ms against 16.6 ms and its busy-loop control exceeds it; romdev session `nr-unit8` ends at the expected tick with state equal to native on GL and WebGPU. `gates/gate-gl.log`, `gates/gate-wgpu.log`, `gates/gate-tools.log`, `controls/controls.json`, `perf/`, `romdev/session-summary.json` |
| Look gate | **pending the owner's checklist** | The R7 capture set is assembled (`look/`, 26 captures after Round 2, native on WebGPU, each with its cart-equality line in `look/set.json`) and `look/CHECKLIST.md` is unfilled. Whatever the brawler gate shows, this gate passes only when every item there is checked |

### Brawler gate: what it checks

For each of `input-2p-full`, `input-waves`, `input-combat`, `input-join-mid`, `input-upgrade` (`games/nr/tests/brawler.mjs` lists
the five with their app and last frame), the host's run is held to the native binary on the same graphics API by:

- the whitelisted simulation state (43 `nr.*` fields: every actor, the rng, camera, lights, lives, wave, phase, pick, joins,
  the sounds the simulation asked for, the event log, both checksums), exact, with a field missing or not finite on either side a
  rejection (`games/nr/tests/gate-strict.mjs`, built on the spike's predicates);
- the frame, under the calibrated bound (0.0005 of the pixels differing by more than 16 levels; below);
- zero cumulative `cw.three.missing` and no program state named in `cw.three.missing_states`, on every host and on native;
- the committed golden of the script (`games/nr/tests/goldens.json`): the final `nr.checksum` and 13 more final-state fields,
  on native and on the host;
- the script's facts: `input-2p-full` ends with `nr.phase == clear` (the clear screen), wave index 4 reached, both players
  present, alive (hp > 0, not dead) and the count of players 2; `input-waves` ends cleared at wave index 4 with both alive;
  `input-join-mid` has exactly one join; `input-upgrade` has the dash picked.

Each stock entry also runs the engine's control: the native run one frame short must not match.

| Script | Frames (the last frame) | Final `nr.checksum` (golden) | Facts at the end |
| --- | ---: | ---: | --- |
| `input-2p-full` (nr) | 2164 | 1196977218 | phase clear, wave 4, cleared, 2 players, lives 4, dash picked |
| `input-waves` (nr_waves) | 2099 | 1922784415 | last wave ended (tick 2099), wave 4, 2 players alive |
| `input-combat` (nr_dummies) | 658 | 1835212864 | both players hp 12 and 9, the dummies' state as scripted |
| `input-join-mid` (nr) | 790 | 3971475687 | one join, 2 players, wave 2 |
| `input-upgrade` (nr) | 989 | 1355188033 | dash picked, wave 3 |

The last frame of each is where the picture is still changing, so that the image predicate can see a one-frame shift: the clear
screen of `input-2p-full` holds still from tick 2165, so the gate runs it to 2164, the tick the arena is cleared (at 2300 a run
one frame short differs by 0 pixels). The whole run to tick 2300 is also held to native in the romdev session below.

Hosts per entry (results in `gates/`): romdev GL (`build/cart`, `loadMedia wgpu:false`), Chromium GL (`build/cart`), Chromium
WebGPU and romdev WebGPU (`build/cart-wgpu`, `loadMedia wgpu:true`), each against the native binary on its own API. The native
binary is the reference; `run-cart.mjs --gpu webgpu` reads a Linux GPU pin and cannot run on macOS, so the WebGPU legs run through
`games/nr/tests/capture-hosts.mjs` (native with `CW_GPU=webgpu`, Chromium through `chromium-wgpu.mjs`, romdev through the HTTP tools
with a deterministic clock). Every WebGPU run reports `cw.gpu.api` 2 and no WebGPU errors.

## Image tolerance calibration

Method of `docs/evidence/shipping-path-spike/README.md`, run on the lit scene by `games/nr/tests/calibrate.mjs`
(`image-calibration.json`, `image-calibration.log`). Per script, three repeats of the native binary and of each of the four hosts
plus every host one frame early. Known good: host against native over all 9 repeat pairs and native against native. Known bad:
the host's frame blanked, in the wrong colour space (sRGB decoded as linear, and encoded twice), and one frame early (host and native).
Tolerance of a pair = 2 x max(good), floor 0.0005; accepted only if at most half of min(bad).

| Pair (host against) | max good gt16 | min bad gt16 (which) | blank / colour space / one frame early, min | tolerance | verdict |
| --- | ---: | ---: | --- | ---: | --- |
| romdev GL (native GL) | 0 | 0.002509 (one frame early, join-mid) | 0.9413 / 0.8914 / 0.002509 | 0.0005 | calibrated |
| Chromium GL (native GL) | 0 | 0.002509 | 0.9413 / 0.8914 / 0.002509 | 0.0005 | calibrated |
| Chromium WebGPU (native WebGPU) | 0 | 0.002513 | 0.9412 / 0.8914 / 0.002513 | 0.0005 | calibrated |
| romdev WebGPU (native WebGPU) | 0 | 0.002513 | 0.9412 / 0.8914 / 0.002513 | 0.0005 | calibrated |

The floor decides the tolerance (twice a maximum of 0 is 0), and the floor is 0.0005 against 0.001255 allowed (half the smallest
bad). Per script the smallest one-frame-early shift is 0.5193 (`2p-full`), 0.0478 (`waves`), 0.1315 (`combat`), 0.0025
(`join-mid`) and 0.0193 (`upgrade`). All four hosts of every script give frames identical to the native frame (romdev against
Chromium on GL, Chromium against romdev on WebGPU: 0 differing pixels in all five).

The first calibration failed: on romdev GL the good maximum was 0.003876 (`2p-full`), 0.003125 (`waves`) and 0.003142
(`join-mid`), above half the smallest bad (0.002509), and the tolerance was not widened (`image-calibration-first-attempt.log`).
The cause was the scene: two haze planes of the sky overlapped (y 0.9 to 1.1) at the same depth, and romdev's GL run ordered them
differently from native in a band at the top of the frame (8,037 pixels in x 0 to 950, y 21 to 41). The arena generator now puts
the second plane 0.02 behind the first (`games/nr/assets/arena/gen-arena.mjs`); the calibration above is the run after that fix.
The simulation checksums did not change.

## Controls

`games/nr/tests/controls.mjs` runs the gate's predicates (image, state, missing, golden) on each broken input on the
title-to-clear script against native, on romdev GL, Chromium GL, Chromium WebGPU and romdev WebGPU: 14 controls x 4 hosts = 56.
Every one failed exactly the predicates it must, with the others green (`controls/controls.json`; `i`, `s`, `m`, `g` below are
the image, state, missing and golden predicates).

| Control | What it is | Fails | Stays green |
| --- | --- | --- | --- |
| base | unmodified run | none | i s m g |
| blank | the host's frame replaced by black (gt16 0.941) | i | s m g |
| wrong colour space | sRGB decoded as linear (0.891) / encoded twice (0.996) | i | s m g |
| 0x0 frame | the host's frame replaced by a 0x0 PNG | i (rejected before any metric) | s m g |
| non-finite field | a null in `nr.light_pos`, the string `NaN` in `nr.hero_pos`, a null scalar `nr.cam_x`, `nr.rng` missing, and a null in the reference's `nr.hero_pos` | s (rejected, the field is named) | i m g |
| non-whitelisted field | `nr.sfx_played` (the voices this host made) altered | none | i s m g |
| one-tick input shift | REAL run with player 2's input one tick late | s (first divergent field `nr.hero_pos`), g (checksum, input count), i (gt16 0.553) | m |
| row removed | REAL cart built without `standard+map+nearest+nmap+atest+l0400`; `cw.three.missing` 1, the state named (on hosts whose state carries the names) | m, i (the draws are skipped) | s g |
| light count changed | REAL cart built with a fifth point light; the four lit rows become `l0500` states with no row (`cw.three.missing` 4, named) | m, i | s g |

Notes: the input shift moves the same fact through the state, the golden and the picture, so those three fail together; `missing`
stays green. Fewer lights is not a control: three.c draws a frame with fewer lights than a row's with that row, so a lost light
changes no program state; the control adds one. `run-cart.mjs`'s romdev host does not carry byte fields, so on romdev GL the
removed row is checked by `cw.three.missing == 1` and not by name (`namesChecked: false`); the other three hosts check the name. The
nr HUD draws no tick counter, so the spike's tick-counter-only control has no counterpart; the non-whitelisted control is its
state-side analogue and nothing fails.

## Perf

Native: `games/nr/tests/perf-native.mjs` on `nr_stress` (`games/nr/main.c`, `NR_STRESS`): the wave-4 population, 8 grunts, a
heavy, both heroes and the street block with 4 point lights at 1920x1080 (640x360 scene), every actor on a frame of its own
(11 distinct atlas frames, advancing every 6 ticks, so each draws as its own non-instanced plane), no waves, no title. GL
backend, no vsync, no pacing; 120 warm-up frames and 600 measured, 10 runs, the one-pixel `glReadPixels` build (`NR_PERF`) so every frame
includes its GPU work. Budget 16.6 ms.

| Series | p50 (median of runs) | p99 (median of runs) | p99, worst run | max, worst run |
| --- | ---: | ---: | ---: | ---: |
| native, with GPU work (done), 10 runs | 0.845 ms | 1.082 ms | **1.163 ms** | 3.021 ms |
| native, CPU submit, 10 runs | 0.847 ms | 1.073 ms | 1.135 ms | 3.038 ms |
| busy-loop control (2.0 ms per actor per frame, 22 ms), 3 runs | 23.391 ms | 23.642 ms | **23.683 ms** | 29.121 ms |

The worst p99 is 7 % of the budget; the control is 1.4 times the budget, so the measurement can see a frame over it. Every run
ended at tick 721 with checksum 62082975 and `cw.three.missing` 0. The scene has no HUD (`nr_stress` has no title or screens), so the
render2d draws of the full game are not in these numbers.

Cart hosts, recorded and not gated (`perf/*.json`, `perf/carts.log`; 3 runs x 600 frames after 120 warm-up, the cart's own clock virtual
and deterministic, every time on the host's real clock):

| Host | Series | p50 | p99 (median / worst run) | max |
| --- | --- | ---: | ---: | ---: |
| Chromium GL | `runFrame()` (wasm, GL submit; the GPU runs in another process) | 0.20 ms | 0.28 / 0.28 ms | 0.55 ms |
| Chromium WebGPU | `runFrame()` (submit) | 0.29 ms | 0.45 / 0.47 ms | 4.0 ms |
| Chromium WebGPU | `runFrame()` + `readGpuFrame()` (waits for the GPU, reads 1080p back) | 6.5 ms | 8.7 / 8.7 ms | n/a |
| romdev GL | one `frame{step 1}` HTTP call per frame | 3.57 ms | 6.54 / 6.54 ms | 140 ms |
| romdev WebGPU | one `frame{step 1}` HTTP call per frame | 8.83 ms | 15.97 / 16.28 ms | 139 ms |

The romdev rows include the call and the host's frame capture (a `wasm{info}` call that runs no frame costs 0.50 to 0.57 ms at p50),
and its max values are the first frame after a call gap; the Chromium submit rows are not GPU-complete. None of these is a
frame-time claim for a player's browser: they show the cart runs the wave-4 scene on every cart host at a rate well inside a frame
on this machine.

## Memory

The cart's WASM linear memory is 134,217,728 bytes (128 MiB) on romdev and in Chromium, GL and WebGPU, at load and at the end
of every run: that is the memory the host allocated, not what the game touched. What the game touched is measured by scanning
linear memory for 4 KiB pages holding any non-zero byte (`games/nr/tests/perf-carts.mjs`, Chromium), after 120 warm-up frames
and at the end:

| Cart, run | After warm-up | End | Atlas sheets, decoded (computed, Unit 6) |
| --- | ---: | ---: | ---: |
| `nr` (full game), `input-2p-full`, 2300 frames, GL | 45.8 MiB | 46.0 MiB (48,259,072 B) | 36.12 MiB |
| `nr` (full game), `input-2p-full`, 2300 frames, WebGPU | 46.3 MiB | 46.5 MiB (48,750,592 B) | 36.12 MiB |
| `nr_stress`, 720 frames, GL / WebGPU | 44.3 / 44.2 MiB | 44.3 / 44.2 MiB | 36.12 MiB |

All of the game's memory, the three decoded atlases included, is under the 64 MiB the atlas budget allows for the atlases
alone (46.5 MiB at most), and about 36 % of the 128 MiB wasm. The engine's own tag counts through `stats` (`mem_total` 77,814 B
on `nr_stress` after warm-up, `perf/romdev-gl-nr_stress.json`) do not include the atlas pixel buffers. Native process RSS on
`nr_stress` (not wasm): 105 to 130 MiB at the end, 148 to 172 MiB peak (`perf/native-nr_stress.summary.json`).

## romdev session `nr-unit8`

`games/nr/tests/romdev-unit8.mjs`, one session, `build/cart-wgpu/carts/nr.wasc`, a GL run (`loadMedia wgpu:false`, reported
`gpu: gl`) and a WebGPU run (`wgpu:true`, `gpu: webgpu`, adapter apple metal-3, apple-m1-pro). For each:

- `wasm{conformance}`: conforms, abi 4.
- `input-2p-full` as `input{sequence}` steps with the load frame counted (`loadMedia` ran frame 1; `docs/solutions/logic-errors/romdev-loadmedia-consumes-frame-one-2026-10-24.md`):
  `nr.ticks` equals the engine frame count at every stop (30, 61, 500, 765, 1000, 2164, 2250, 2300).
- Screenshots of each screen: the title (tick 30), both players joined and the fight begun (61), wave 2 (500), the upgrade
  choice (765), the fight with the HUD (1000), the clear screen (2164 and 2250); `romdev/gl-f*.png`, `romdev/wgpu-f*.png`.
- `debugState` at tick 2164: the golden of `input-2p-full` (checksum 3853076974, `brawlerProblems` empty) and equal to native's
  49 fields; at tick 2300: checksum 1637854936, equal to native's state of tick 2300 on the same API, `cw.three.missing` 0; on
  WebGPU `cw.gpu.api` 2, `cw.gpu.errors` 0 (`romdev/session-summary.json`, `romdev/events.ndjson`, `romdev/*-state-f2300.json`).

The session ends with the cart loaded on the title (WebGPU, tick 1, phase title, no players, `nr.demo` 0) and the session alive
(`romdev/left-at-title.png`). `host{op:play}` was not called, so nothing has been shown on the livestream.

## Scope limits and what is not verified

- One machine and one GPU: every host ran on the same Apple M1 Pro, so the frames are pixel-identical (good maximum 0) and the tolerance is
  the floor. This does not bound the difference between GPUs or drivers; a run on other hardware is compared by the same bound
  and may need the calibration redone.
- The sound effects are generated placeholders (`games/nr/assets/LICENSE-NOTICES.md`); audio ran against SDL's dummy driver and
  nothing was heard.
- Two hero clips are gaps: `jumpkick` and `grab` are the owner's hand-keyed clips, not in the atlas, and the moveset runs without them.
- The darkening at the rims of the normal map on knocked-down bodies (they can read as translucent) is accepted for this slice
  (`unit7/translucency/README.md`); no atlas or pipeline change was made.
- The perf scene has no HUD; the full game's 2D draws are unmeasured. Cart-host times are records, not budgets, and are not GPU-complete
  except the one WebGPU row that waits for the GPU.
- The goldens are the native GL run of this unit; they pin regressions of the simulation and the scripts, and the gate also checks the
  facts of each script. They do not prove the fights are good.
- The look and feel of the captures, the screens and the sounds is the owner's call (look gate).

## Unit 3: hero clip set, render time and atlas size

Measured on the development Mac (Apple Silicon, macOS 15, 10 cores), Blender 4.5.15 Cycles on the CPU, 1 sample,
supersample 4 (a 640x640 render per 160x160 frame), two passes per frame (albedo, normal). `render-times.json` holds
the per-slot wall-clock of two full runs; `clips-check.json` holds the sheet figures.

| Clip | Frames | ms/frame | Clip ms | Render s (run 1 / run 2) | Render ms per frame | Sheet KiB (colour + normal) | Page |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| idle | 8 | 250 | 2000 | 1.10 / 1.04 | 134 | 1,600 | 0 |
| walk | 8 | 120 | 960 | 1.03 / 1.06 | 131 | 1,600 | 0 |
| run | 8 | 90 | 720 | 1.13 / 1.25 | 149 | 1,600 | 0 |
| hit1 | 6 | 60 | 360 | 0.96 / 0.92 | 157 | 1,200 | 0 |
| hit2 | 6 | 60 | 360 | 0.82 / 0.82 | 137 | 1,200 | 0 |
| hit3 | 7 | 60 | 420 | 0.99 / 1.01 | 143 | 1,400 | 0 |
| jump | 6 | 100 | 600 | 0.77 / 0.80 | 131 | 1,200 | 0 |
| throw | 6 | 80 | 480 | 0.82 / 0.86 | 140 | 1,200 | 0 |
| hurt | 4 | 80 | 320 | 0.55 / 0.55 | 138 | 800 | 0 |
| knockdown | 8 | 90 | 720 | 1.14 / 1.07 | 138 | 1,600 | 0 |
| getup | 6 | 90 | 540 | 0.77 / 0.84 | 135 | 1,200 | 0 |
| dash | 6 | 70 | 420 | 0.86 / 0.90 | 147 | 1,200 | 0 |
| special_knockback | 9 | 70 | 630 | 1.12 / 1.27 | 133 | 1,800 | 0 |
| special_dash | 8 | 60 | 480 | 1.07 / 1.23 | 144 | 1,600 | 0 |
| **total** | **96** | | 9010 | 13.13 / 13.63 | 139 | 19,200 | |

- `jumpkick` and `grab` are the owner's hand-keyed clips: placeholder entries in the profile (not ready, no segments, a
  `handKey` note) that the renderer refuses with exit 12, and gap slots in the clip table in `games/nr/anim.c`. They are
  not in the atlas.
- One 1920x1280 page per sheet (12 columns of 160 px, 8 rows), colour and normal alike: 96 of the 144 cells a 2048 page
  holds. 9.375 MiB per sheet, 18.75 MiB for the pair. A full hero render plus post-processing runs in about 20 s of
  wall-clock including Blender's start-up.
- Frame counts are the plan's estimate (the profile's `proposal` values); the budget below did not force a cut.

Atlas budget (written in ADR-0002): all colour and normal sheets of the three characters, decoded, 64 MiB.

| Character | Frames | Sheet pair, one page | MiB |
| --- | ---: | --- | ---: |
| hero, planned (96 rendered + 5 jumpkick + 5 grab) | 106 | 1920x1440 | 21.09 |
| grunt, 25 % of the planned hero | 27 | 1920x480 | 7.03 |
| heavy, 35 % of the planned hero | 38 | 1920x640 | 9.38 |
| total | 171 | | 37.50 |

The loader holds one decoded copy of each sheet (`t3_texture.pixels`) and decodes one sheet at a time, so the load peak
is the total plus the largest sheet: 48.0 MiB, against the 64 MiB budget and the 128 MiB wasm. These are computed from
sheet dimensions, not read from a wasm run (see Unverified).

### Unit 3 test scenarios

| Scenario | Result | Artifact |
| --- | --- | --- |
| Every clip has at least 4 frames and its pivot inside its rect | pass: 14 clips, 96 frames, pivot (80, 144) in every 160x160 rect; no silhouette within 3 px of a cell edge (x 15 to 155) | `unit3/clips-check.txt`, `unit3/clips-check.json` |
| Full-set render twice gives identical manifest and sheet hashes | pass: manifest, colour sheet and normal sheet byte-identical across two runs (and a third, the committed install); `inputs` and every `pixelsSha256` equal | `unit3/reproducibility.json`, `unit3/hero-profile-test.txt` |
| A clip beyond one page continues on the next page and the manifest records the page | pass: the same 96 raw frames packed at a 640 page size give 6 pages, `frames[].page = floor(index / 16)`, the clips crossing a page listed; the committed hero set has one page (the loader reads one) | `unit3/spill-pages.json`, `unit3/clips-check.txt` |
| A normal rect that differs from its colour rect fails naming the frame | pass: a normal cell swapped in from frame 70 fails `frame 5 (idle 5): the normal sheet's rect differs ... at texel (85, 22)`; a pivot outside its rect fails naming `frame 3 (idle 3)` | `unit3/rect-mismatch.txt`, `unit3/clips-check.txt` |
| The renderer refuses the two gap clips | pass: exit 12 `is not ready (a gap awaiting a hand-keyed action)` | `unit3/hero-profile-test.txt` |
| Clip table in `anim.c` matches the profile and the atlas | pass: 16 slots, 2 gaps, enum and table agree | `unit3/clips-check.txt` |
| The Unit 2 checks hold on the full atlas | pass: look captures on native and cart (WebGPU pictures, GL state runs) identical with `cw.three.missing` 0; lit-side swing ratios 8.98x to 9.81x horizontal and 7.27x to 8.28x vertical (floor 2x), signs as expected; stage check green (distinct frames, silhouette IoU 0.995 to 1.000, 3x nearest) | `unit3/unit2-checks/` |

Contact sheet for the owner's eye: `unit3/contact.png`, one row per clip, 4x nearest, the ground pivot in magenta.

Regenerate:

    OUT=out/unit3/final INSTALL=games/nr/assets/atlases tools/render/render-all.sh hero
    OUT=out/unit3/test PUBLISH=docs/evidence/combat-slice/unit3 node --test tools/render/tests/hero-profile.mjs
    node games/nr/tests/clips-check.mjs --out out/unit3/clips-check --publish docs/evidence/combat-slice/unit3

### Unverified in Unit 3

- Wasm resident memory with the full hero atlas is computed, not measured in a cart run. Unit 6 re-verifies the total
  with the three atlases loaded.
- Cross-machine render equality: the hashes are equal on this machine only, as ADR-0002 defines.
- The Unit 2 checks were run on a clean copy of HEAD plus the Unit 3 files (`main.c` unchanged from Unit 2), not on the
  working tree that Unit 4 is changing.

## Round 2: the look-gate review

`look/REVIEW-oracle.md` (HEAD 600cf0a) found six things. Each is fixed in its own commit; the table lists finding, fix, and the captures
before (the 600cf0a set, in git history) and after (`look/`). The decisions and numbers are in ADR-0002 ("Round 2"). One machine, as above.

| # | Finding | Fix | Captures (before > after) |
| --- | --- | --- | --- |
| 1 | The combat captures used dummies, and hit 3 and the contact tick were missing | `nr_look`: real grunts and a heavy that stand still, three stations, `input-look.json`; contact tick chosen inside the active window and asserted from state | `combat-hit2` (dummies, tick 49 of `input-combat`) > `combat-hit2` (real grunt, `input-look` 264); new `combat-hit3` (280); `combat-radius-special` > same name (124); `combat-dash-special` > same name (49) |
| 2 | The heavy's plates, gauntlets and boots sat on the street under the darkest neon | `heavy.json` palette values and trim coverage raised, ambient untouched; re-pinned, re-rendered, reinstalled | `heavy-windup`, `heavy-staggered`, `wave4-crowd`: boots 8.4 > 76.8 against a street ring of 26.4 > 70.7 (windup); `round2/heavy-contrast.txt` |
| 3 | P1 and P2 could not be mapped to the HUD's magenta and cyan | `hero-p2` atlas: the same render with `hair`, `trim`, `glove` overridden to the HUD's cyan; the hero's accents are the HUD's magenta; player 2 draws the second colour sheet over the hero's geometry and normals | every capture with both players: `scroll-f061`, `combat-hit2`, `wave4-crowd`, `heavy-staggered`, `hud`; `round2/hero-variant-check.txt` |
| 4 | The camera clamp's silhouette allowance was a fixed 0.45 | `CAMERA_ALLOWANCE` 1.2, the hero's widest frame (1.188, `special_dash`), from `reach-check`; FOV and pitch unchanged | `scroll-f232`, `scroll-f640` (the leash holds a whole hero at the edge); `round2/reach-check.txt` |
| 5 | The static street read flat | plinths, cornices, pilasters, framed windows and sills on the storefronts; plinth, capital and panel lines on the pillar; no tied planes (`depth-check`) | `scroll-f061`, `scroll-f352`, `pillar`, `pillar-bare` |
| 6 | The title prompt faded into the hero and the lit ground | dark panel with an amber edge, text at full strength | `title`: 2.33:1 > 8.31:1 (dim phase) and 8.91:1; `round2/title-contrast-check.json` |

The wave captures moved to ticks that still show their state under the new leash: `grunt-airborne` 450 > 424, `heavy-windup` 990 > 935,
`wave4-crowd` 1600 > 1560, `heavy-staggered` 2050 > 1910.

### Simulation, goldens and gates

Presentation-only for findings 1, 2, 3, 5 and 6: the simulation's inputs are unchanged (`sim.passive` is read only by `nr_look`'s scene and
is outside the checksum). **Finding 4 is a simulation change and was unavoidable**: the allowance is the leash's input, which sets where
players and wave enemies may stand. The bot-driven scripts (`input-2p-full`, `-waves`, `-join-mid`, `-upgrade`, `-upgrade-join`,
`-upgrade-tie`) were regenerated from the bots, `goldens.json` rewritten (the table above; `input-combat`'s checksum 1835212864 is
unchanged), and two gate runs end on other ticks (waves 2374 > 2099 and join-mid 800 > 790, ticks where the picture still changes).
The leader's soft wall is 7.6 units ahead of the trailing player (was 9.1).

| Run | Result | Log |
| --- | --- | --- |
| `gate.mjs` (23 entries: 10 stock nr, spike's, `nr-strict`, `nr-wgpu` x 5 scripts x 2 hosts, `nr-controls` 56) | exit 0, every entry `ok` | `round2/gates/gate-all.log` |
| `sim-check` | 27 `ok` | `round2/sim-check.log` |
| `ui-check` | 12 scenarios passed; 0 glyph bakes after frame 0 | `round2/ui-check.log` |
| `scroll-check`, `ordering-check` | passed (pillar: 964 of 964 overlap pixels hidden behind it, in front 2156 of 2156) | `round2/scroll-check2.log`, `round2/ordering-check2.log` |
| `stage-check`, `lit-side-check` (right and left) | passed; swing ratios 9.71x and 8.97x horizontal, 7.16x and 6.49x vertical (floor 2x) | `round2/lit-side-check.log`, `-left.log` |
| `programs-survey`, `programs-controls` | no new program state; every row-removal control gives `cw.three.missing` 1 naming it | `round2/programs-controls.log` |
| `clips-check`, `enemies-check`, `tools/render/tests` | 12 of 12, 17 of 17, 22 pass | `round2/clips-check.log`, `enemies-check.log`, `render-tests.log` |
| `depth-check` (and its control) | 0 ties; the control finds the planted tie | `round2/depth-check*.txt` |
| `look-set` | 26 captures, every one pixel-identical to native with equal state (43 fields) and `cw.three.missing` 0/0 | `round2/look-set.log`, `look/set.json` |

`lit-side-check` no longer asserts the sign of a response within 0.5 of zero (the vertical sweep's first frame: the small up-facing class
responds by -0.01 with the accents recoloured); its swing ratios, which decide, are as before. The control carts of `controls.mjs` are cached
under `out/`; the cache is now invalidated by any newer source or asset of the game (a stale cache ran the previous sim and failed 8 controls).

### Atlas budget

Decoded: hero 18.75 MiB, grunt 7.03, heavy 10.34 = 36.12 MiB for the three atlases (unchanged), plus player 2's colour sheet 9.38 MiB =
**45.49 MiB** against 64 MiB (`round2/hero-variant-check.txt`). Touched in a cart run at the end of the full game: 52.6 MiB on GL and 53.1 MiB
on WebGPU of the 128 MiB wasm (`round2/perf/`), up from 46.0 and 46.5.

### Not verified in Round 2

- The owner's checklist is unfilled; whether the fixes read right is theirs. No before and after pictures were compared by eye beyond the
  agent's own look at the captures.
- One machine and one GPU, as above; the cart frames equal native's here.
- The heavy's hook (1.69 units) still reaches past the 1.2 allowance for the ticks it plays at the frame's edge; holding it in would take
  1.7 units, 2.5 of the screen's 10 (ADR-0002).
- Hit 3's capture shows the UAL hook's bent-over pose at tick 8 of the state (the clip frame whose reach, 1.08 units, was the widest the ticks tested drew); the other ticks of its active window were not compared by eye.
- `host{op:play}` was not called; the romdev session below ends on the cart at the title.
