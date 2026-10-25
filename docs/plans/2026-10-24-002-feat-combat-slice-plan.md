---
title: "feat: Combat slice — lit sprite brawler in one three.c arena"
type: feat
status: active
date: 2026-10-24
origin: docs/brainstorms/2026-10-24-combat-slice-requirements.md
---

# feat: Combat slice — lit sprite brawler in one three.c arena

## Overview

Build `games/nr/`: one street-block arena, one hero, grunts and a heavy, a special with two variants, one mid-arena upgrade, one or two local players. Actors are hi-bit pre-rendered sprite frames with normal maps, rendered as three.c planes lit by the arena's neon point lights. A new Blender render pipeline produces every clip. Two gates close the slice: the look gate (owner-judged capture checklist on native and cart) and the brawler gate (two-player title-to-clear with identical simulation state on every host).

## Problem Frame

The shipping-path spike proved the build, cart, gate and romdev loop; the lit-sprite spike proved that a normal-mapped alpha-tested plane under point lights renders identically on GL and WebGPU across native, Chromium and romdev with zero missing program states. Neither says what the game looks like. The art pipeline is the largest unproven cost: Panthea's route produced locomotion for one kit-rigged character and bakes a toon key light into its colour pass, so it cannot supply unlit albedo or normals. Camera, pixel density and lighting lock once art production starts (see origin: `docs/brainstorms/2026-10-24-combat-slice-requirements.md`).

## Requirements Trace

Numbering follows the origin document.

- R1–R2: 640×360 virtual resolution, ~128 px hero, fixed-angle perspective belt camera.
- R3–R4: sprite frames + normal maps as three.c planes; neon point lights visibly shade actors.
- R5–R6: one street block, three screens wide, 3D storefronts/pillars with parallax, 3–4 animated lights; ground-y occlusion.
- R7: look approved from a fixed capture set with a yes/no checklist.
- R8–R10: twelve hero clips; grab fails on heavies; two special variants.
- R11–R13: grunt and heavy behaviour; alternate target assignment on spawn.
- R14–R15: mid-arena upgrade choice, first pick wins, persists.
- R16–R18: join from title or mid-fight; no friendly fire; shared lives; camera clamp and one-screen leash.
- R19–R23: scripted reproducible render route; three characters' clip sets from it; grunt/heavy clip lists; waves and lives; characters as owner-authored profiles over pinned CC0 kits, with provenance.
- Gates: look gate and brawler gate (origin Success Criteria).

## Scope Boundaries

- No destructibles, ranged enemies, bosses, stat upgrades, friendly fire, second arena/hero, cutscenes, hub, online, consoles.
- Combat tuned for correctness and readability, not feel.
- No new engine features; three.c and Cartwheel used as pinned.
- No Panthea code copied; its render script is not invoked.

### Deferred to Separate Tasks

- Combat feel (hitstop, buffering, cancels): next slice.
- Upstreaming a `model` profile + normal role to Panthea: optional later; the nr script is self-contained.
- Interpolation for non-60 Hz hosts: only if a host runs below 60.
- CI cart builds and Releases: after this slice.

## Context & Research

### Relevant Code and Patterns

- `games/spike/main.c`: action table and two-player `cw_action_*` reads in the fixed tick; `depth_z()` ground-y ordering with id tiebreak; `draw_hud()` with glyph prewarm; audio init/play; `report_missing()` + debug whitelist; `t3_renderer_reset_bindings` before every 3D render.
- `games/litspike/main.c`: `standard_material()` (map sRGB + normalMap NoColorSpace, nearest, alphaTest) and `lights_at()` deterministic light sweep; `tests/lit-side-check.mjs`, `capture-hosts.mjs`, `chromium-wgpu.mjs`, `romdev-session.mjs` (livestream play + wgpu leg).
- `games/spike/tests/`: `whitelist.mjs`, `gate-strict.mjs`, `controls.mjs`, `calibrate.mjs`, `perf-native.mjs`, `pak-manifest.mjs`, input-script format (neutral frame-1 entry).
- `tests/gates.json`: stock entries + tool gates.
- Engine (`deps/cartwheel-engine`): input limits and player↔pad mapping `include/cartwheel/input.h:59-62,160-167`, pad presence `platform.h:42-48`; audio voices/priority `audio.h:99-106,154-156`; fixed tick `src/platform/sdl_common.c:848-875`; `pixel_scale`/`render_scale` `platform.h:135-174`; asset manifest `docs/guides/resources.md:96-126`; melee numbers in `games/action2d/actors.c:250-262,492-534,562-582`.
- three.c (`deps/cartwheel-engine/deps/three.c`): texture `offset/repeat` `include/three.h:175-176` applied per draw via `GOP_TEX_MATRIX` (`src/renderer_gen.inc:645-653`); batch key excludes UV transform (`src/renderer.c:2003-2012`), so distinct frames per actor need distinct geometry; `T3_MAX_LIGHTS 8` per type (`src/renderer.c:109`); light count is in the state key.
- cartwheel-examples `8b6d18d` (`/tmp/cartwheel-examples`): `games/bomberdude/` for integer sim split from presentation, title/menu/HUD state machine (`main.c:1234-1646`), `assets/input.cfg` with pads 2–4; `games/derby/main.c:1366-1378` title join; `games/chromite/script.c` + `sim.c:289,510` for seeded wave schedule, AABB hits and enemy step.
- Panthea `9556db8` (`/tmp/panthea`): recipe/sentinel/exit-code contract (`tools/render/blender/render.py:4`, exit codes 0/1/10/11/12), Blender-pin check (`render.py:2050-2056`), EEVEE determinism settings (`render.py:~195-215`), supersample + downscale, id/depth passes, `camera.json` pivot model. Transfer as design only.

### Institutional Learnings

- `docs/solutions/runtime-errors/three-c-depth-state-lost-after-render2d-2026-10-24.md`: reset bindings before each 3D render.
- `docs/solutions/workflow-issues/cartwheel-programs-survey-out-of-tree-2026-10-24.md`: survey from `CW_PROGRAMS_LOG_DIR` runs, `--build build/native`, commit manifest + both C tables; publish `cw.three.missing` from the app.
- `docs/solutions/logic-errors/romdev-loadmedia-consumes-frame-one-2026-10-24.md`: input scripts start neutral at frame 1; count from host `frameCount`.
- `docs/solutions/developer-experience/cartwheel-runners-on-macos-env-2026-10-24.md`: `CW_TEST_GPU=desktop` / `software` + `CW_WGPU_ADAPTER=apple`.
- `docs/solutions/integration-issues/romdev-gles-node-linux-binary-on-macos-2026-10-24.md`: native-gles and native-dawn repairs.
- `docs/solutions/best-practices/darwin-arm64-wasi-sdk-builds-cartwheel-carts-2026-10-24.md`.

### External References

- Blender 4.5 LTS headless (`--background --python`), Standard view transform for exact colour, Cycles seed/denoise off; the View Layer Normal pass is world-space and must be re-based to the sprite plane; OpenGL green-up convention; CPU render for hash reproducibility (docs.blender.org/manual/en/4.5).
- Normal-map downsampling as vectors with renormalisation (NVIDIA "Mipmapping normal maps").
- TexturePacker CLI packs a normal sheet with the same layout as the colour sheet (codeandweb.com/texturepacker/documentation); Aseprite JSON for frame/pivot/duration shape.
- Streets of Rage 4: ~1000 frames per playable character, 300–400 per enemy (PlayStation Blog, 2020); the slice's ~130–165 unique frames is a planning estimate.
- Character kits (all CC0, redistributable, no attribution required; no publisher checksums, so `kits.json` pins URL + local sha256): Quaternius Universal Base Characters (quaternius.com/packs/universalbasecharacters.html; 6 bases Superhero/Regular/Teen × M/F, 20 hairstyles, source ZIP has .blend), Universal Animation Library 1 (universalanimationlibrary.html; 8-dir locomotion, jog/sprint, death, combat) and 2 (universalanimationlibrary2.html; 130+, "3 and 4 hit combos split into separate hits with their recoveries", melee combos, parkour, zombie locomotion), Modular Character Outfits (fantasy set; streetwear needs retexture). Disqualified for repo redistribution: Mixamo (source files), Synty (EULA), Bandai mocap dataset 1 (CC-BY-NC), Cascadeur Free (non-commercial).
- Panthea Studio (marcusrbrown/panthea@9556db8 `tools/studio`, `tools/render/kits.json`, `profiles/*.json`, ADR-0012): the profile → kit → headless render → post → conform → manifest shape nr follows; the registry/publish layer is not ported.
- cart-wgpu SDK asset `cartwheel-sdk-0.15.1-cart-wgpu.tar.gz`, sha256 `777167301a0afaf515ef78e1ca3514ceac3ff9f1c3eade7d92ced36e8d57d4a7` (`gh release view v0.15.1` digest, local shasum, `out/litspike/wgpu-probe/sdk.sha256`).
- Blender 4.5.15 LTS (latest 4.5.x on 2026-10-24) ships macOS arm64 as a `.dmg` with a published SHA-256 list at download.blender.org/release/Blender4.5/.

## Prior-Art Survey

```json
{
  "schema_version": 2,
  "verdict": "extend",
  "scope": "marcusrbrown/nr at 390ffd4: games/spike, games/litspike, scripts/, tests/gates.json",
  "freshness": { "vcs_reference": "390ffd4" },
  "budget": { "max_search_passes": 6, "max_candidate_inspections": 25, "exhausted": false },
  "candidates": [
    { "path_or_symbol": "games/spike/main.c: action table, player_tick, depth_z, draw_hud, audio, report_missing", "description": "Two-player actions in the fixed tick, ground-y depth with id tiebreak, HUD text with prewarm, one-shot audio, missing-state publication.", "disposition": "extend" },
    { "path_or_symbol": "games/litspike/main.c: standard_material, load_sprite, lights_at", "description": "Lit normal-mapped alpha-tested plane under sweeping point lights; one static texture pair.", "disposition": "extend" },
    { "path_or_symbol": "games/spike/tests/* and games/litspike/tests/*", "description": "Whitelist, strict gate, controls, calibration, perf, pak-manifest, host capture, lit-side check, romdev session with livestream and wgpu leg.", "disposition": "extend" },
    { "path_or_symbol": "games/litspike/programs/*", "description": "standard+map+nearest+instbig+nmap+atest+l0300 and standard+l0300.", "disposition": "extend" },
    { "path_or_symbol": "games/spike/main.c: crowd wander", "description": "Seeded random walk; no targeting, damage, waves or camera.", "disposition": "insufficient", "insufficiency_reason": "No combat, AI, spawning, camera or atlas animation exists anywhere in the repo." },
    { "path_or_symbol": "scripts/deps.lock, fetch-deps.sh, build.sh, preflight.sh", "description": "Lock-driven sha256 fetch, two-target build; GL-only cart SDK.", "disposition": "extend" }
  ],
  "excluded_scopes": [
    { "scope": "monteslu/cartwheel-engine@4a5f73e games/action2d/actors.c", "disposition": "reuse", "reason": "Hitbox windows (9 active/18 cooldown), knockback 8 ticks, invuln 60 and chase radius reused as starting constants; node architecture not reused." },
    { "scope": "monteslu/cartwheel-examples@8b6d18d", "disposition": "reuse", "reason": "Patterns for title/join/HUD state machine and seeded wave schedule; no sprite-sheet animation or melee in the examples." },
    { "scope": "marcusrbrown/panthea@9556db8 tools/render", "disposition": "insufficient", "reason": "Toon-lit colour pass, no normal role, kit-rig only, isometric camera; design contract reused, code not invoked." }
  ]
}
```

## Key Technical Decisions

- **Kit route for characters (Panthea Studio shape)**: bodies and clips come from pinned CC0 Quaternius kits (`tools/render/kits.json`: URL, licence, sha256 per file, fail-closed); each character is a profile JSON (base, hair, proportions, outfit/retexture, clip map state→clip+frames+durations, pose policy, props) that the owner authors with agent drafts. Clips the libraries lack are hand-keyed in Blender and pinned as `.blend` actions; nothing is generated by image→mesh.
- **New nr-owned Blender script, not Panthea's**: `tools/render/nr_render.py` under GPL-3.0-or-later (`LICENSES/GPL-3.0-or-later.txt`), invoked as a tool; the game stays MIT. It emits unlit albedo, plane-space normal, and id/depth per frame from a JSON recipe with Panthea's sentinel and exit-code contract.
- **Blender 4.5 LTS, CPU Cycles, Standard view transform, seed fixed, denoise off**: reproducibility is defined as identical atlas payload hashes on the pinned build on one supported machine class; cross-machine equality is measured, not promised.
- **Normals are plane-space**: the script transforms shading normals into the sprite plane's basis (screen-right, screen-up, toward camera), OpenGL green-up, and renormalises after downsampling. three.c's derivative tangent frame on a plane maps that basis directly; the lit spike proved the horizontal response only, so Unit 1 adds a vertical control (a flat-plane constancy check cannot detect a green flip).
- **One plane geometry per atlas frame, one material per character**: three.c batching keys on geometry+material and the UV transform lives on the texture, so per-actor UV offsets cannot share a material. Pre-built per-frame geometries keep one material and texture pair per character; actors on the same frame still batch. Adds the non-instanced `standard+map+nearest+nmap+atest+l0300` row.
- **Fixed light count**: 4 point lights always present — three arena neons plus one flash slot for the special (intensity 0 when idle) — so one program state (`l0400`, unproven by the lit spike which used `l0300`) covers the whole game; Unit 2 proves it.
- **640×360 via `pixel_scale 3` (proposed, pending the Unit 2 check)**: logical 1920×1080 rendered at a third and nearest-upscaled. If the 3D window renderer ignores `pixel_scale`, the default becomes a 640×360 render target blitted up. Density is not locked until the check passes. A cart host that states a preferred size receives the low-res frame and scales itself, so the upscale check is per host.
- **Add `cart-wgpu` beside `cart`**: the engine runner resolves GL carts from `build/cart` and dual GL+WebGPU carts from `build/cart-wgpu`, and the engine lock keeps `wasmcart` and `wasmcart-wgpu` as separate pins, so both targets stay. New lock rows: `cartwheel-sdk:cart-wgpu` (v0.15.1, sha256 `777167301a0afaf515ef78e1ca3514ceac3ff9f1c3eade7d92ced36e8d57d4a7`, verified against the GitHub release digest before the lock is written) and `wasmcart-wgpu` (engine pin v0.34.3 `cd233ea`, cross-checked like `wasmcart`). Dependency change approved by the owner at planning.
- **Integer-ish deterministic sim separate from presentation**: positions in fixed-point or float with `-ffp-contract=off` and engine deterministic math only (as the spike), sim in `sim.c`, rendering in `main.c`; the whitelist + rolling checksum is the gate currency.
- **Targeting**: alternate assignment on spawn; retarget on target death/leave. Grunts use `action2d`'s chase numbers as starting constants.
- **Camera**: follows the players' midpoint along x, clamps so both stay in frame, soft wall one screen width ahead of the trailing player; never scrolls backward past cleared waves.

## Open Questions

### Resolved During Planning

- Panthea pipeline transfer: design only; its script cannot produce albedo or normals. Resolved to a new script.
- Per-actor frames with instancing: per-frame geometry, not UV offset.
- WebGPU carts: cart-wgpu SDK replaces the GL-only pin.
- Blender version: 4.5 LTS.

### Deferred to Implementation

- Exact camera angle/FOV and plane tilt: tuned in Unit 2 against the 128 px target and the AE6 occlusion captures.
- Frame counts per clip: start from the research estimate (idle/walk 6–8, hits 5–7, hurt/knockdown 4–8, specials 6–10) and cut to the atlas budget measured in Unit 3.
- Atlas budget: set from the spike's memory numbers (engine `mem_total` 8.3 MB, wasm 128 MiB) once one hero set is packed.
- Whether `pixel_scale` works with the 3D window renderer (Unit 2 check).
- Image tolerance for lit scenes: recalibrated in Unit 8 with the predeclared method.

## Output Structure

    games/nr/
      CMakeLists.txt                 cw_add_app(nr) + nr_stress variant
      main.c                         app, camera, rendering, HUD, title/upgrade/end screens
      sim.c / sim.h                  deterministic simulation: actors, hits, waves, lives, targeting
      anim.c / anim.h                atlas manifest loader, per-frame plane geometries, clip playback
      assets/roots.txt
      assets/atlases/<char>.png, <char>-n.png, <char>.json
      assets/arena/*.glb or generated geometry, lights.json
      assets/audio/*.wav, fonts/, LICENSE-NOTICES.md, PROVENANCE.md
      programs/nr.txt, nr_gl.c, nr_wgpu.c
      tests/input-*.json, whitelist.mjs, controls.mjs, look-captures.mjs, romdev-session.mjs, perf-native.mjs
    tools/render/
      nr_render.py                   Blender script (GPL-3.0-or-later)
      recipe.schema.json             recipe contract
      post.mjs                       downsample (vector-renormalised normals), pack, manifest, hashes
      render-all.sh                  pinned Blender invocation per character
      recipes/hero.json, grunt.json, heavy.json
    LICENSES/GPL-3.0-or-later.txt
    scripts/deps.lock                + cart-wgpu SDK, Blender 4.5.x
    docs/evidence/combat-slice/README.md (+ look captures, states, perf)
    docs/decisions/0002-render-pipeline-and-look.md

## High-Level Technical Design

> *Directional guidance for review, not implementation specification.*

```
kits.json (UBC body + UAL1/UAL2 clips, sha256) + profiles/<char>.json (owner) ──▶ Blender 4.5 (nr_render.py, recipe.json)
   ▶ per frame: albedo.png, normal_plane.png, id.png, depth.png (supersampled, CPU Cycles, Standard)
   ▶ post.mjs: downsample (nearest colour / vector-avg+renormalise normal), pack colour+normal sheets
     with identical layout, write <char>.json {frames[{rect,pivot,ms,clip}], sha256s, recipe hash}
   ▶ cwpack via roots.txt (texture.format keep) ──▶ game loads atlas + manifest

runtime tick (60 Hz, deterministic):
   input snapshot ─▶ sim.c (players, enemies, hits, grabs, waves, lives, targeting, camera x)
                 ─▶ anim.c picks frame per actor ─▶ main.c swaps that actor's plane geometry,
                    sets plane xz from ground-y, y from jump; lights_at(t); t3 render; render2d HUD
```

## Implementation Units

- [ ] **Unit 1: Toolchain pins and render pipeline skeleton**

**Goal:** Pin Blender 4.5 LTS and the cart-wgpu SDK; create the Blender render script and post-processing with a placeholder model so the whole route runs end to end before any real art.

**Requirements:** R19, R3

**Dependencies:** romdev host repaired for WebGPU (native-dawn, `docs/solutions/integration-issues/romdev-gles-node-linux-binary-on-macos-2026-10-24.md`); preflight fails the WebGPU leg with that fix command when `webgpu-node` does not load.

**Files:**
- Create: `tools/render/nr_render.py`, `tools/render/recipe.schema.json`, `tools/render/post.mjs`, `tools/render/render-all.sh`, `tools/render/recipes/placeholder.json`, `tools/render/recipes/flat-control.json`, `tools/render/recipes/vertical-control.json`, `LICENSES/GPL-3.0-or-later.txt`, `docs/decisions/0002-render-pipeline-and-look.md`
- Modify: `scripts/deps.lock` (rows: `cartwheel-sdk:cart-wgpu`, `wasmcart-wgpu`, `blender` 4.5.15 `macos-arm64` `.dmg` + the sha256 from Blender's published checksum file), `scripts/fetch-deps.sh` (fetch cart-wgpu into `deps/cartwheel-sdk/cart-wgpu` with the same wasi-sdk/binaryen symlinks as `cart`; fetch `wasmcart-wgpu` with the engine-pin cross-check beside the `wasmcart` one; a `.dmg` path — `hdiutil attach`, copy `Blender.app`, detach — into `deps/blender`, sha-checked and staged like the tarballs), `scripts/build.sh` (new `cart-wgpu` target → `build/cart-wgpu`; `cart` unchanged), `scripts/preflight.sh` (`installed.sdk_cart_wgpu`, `installed.blender` version required; `romdev.webgpu_module_loads`), `scripts/gen-pins-table.mjs` (if the new row kinds need it), `docs/decisions/0001-engine-and-toolchain-pins.md` (amendment + regenerated table)
- Test: `tools/render/tests/pipeline-roundtrip.mjs`

**Approach:**
- Recipe contract borrows Panthea's shape: pinned Blender version check (exit 11 on mismatch), `slots[{clip, frames, facing}]`, camera block, output dir, `done.json` sentinel; exit codes 0/1/10/11/12.
- Render settings: Cycles CPU, fixed seed, denoise off, Standard view transform, exposure 0, gamma 1, transparent film, 4× supersample of the target cell.
- Normal output: material override emitting the shading normal in the sprite-plane basis (camera right/up/forward), encoded OpenGL green-up. Two controls: a flat-plane recipe whose normal must be constant (0.5,0.5,1) (constancy only; it cannot detect a green flip), and a vertical-control recipe (a sphere or tilted bump) whose top-facing texels must encode green > 0.5 and whose in-engine lit side must follow a light swept above and below the sprite.
- `post.mjs`: nearest downsample for colour with alpha-edge dilation, vector-average + renormalise for normals, pack colour and normal into identically laid-out sheets (own packer or TexturePacker CLI if pinned), emit `<char>.json` with frame rects, pivots, durations, clip names, and sha256 of inputs/outputs/recipe.
- ADR-0002 records camera, pixel density, lighting, normal convention, licence split, and the reproducibility definition.

**Patterns to follow:** Panthea `render.py` recipe/sentinel/exit codes and determinism block; `games/litspike/tools/gen-lit-placeholders.mjs` for deterministic PNG writing; spike `pak-manifest.mjs` for payload hashing.

**Test scenarios:**
- Happy path: placeholder recipe renders 4 frames → `post.mjs` emits colour sheet, normal sheet, manifest; running twice yields identical sha256 for all three.
- Happy path: flat-plane control recipe → normal sheet is uniform (0.5,0.5,1) within ±1/255.
- Edge case: a frame with zero visible pixels → manifest marks it empty rather than failing.
- Error path: Blender version mismatch → exit 11, no outputs, message names expected/found.
- Error path: tampered sha256 for cart-wgpu in the lock → fetch aborts, no partial dir.
- Happy path: vertical-control sheet has green > 0.5 on top-facing texels and < 0.5 on bottom-facing ones.
- Integration: `TARGETS="native cart cart-wgpu" scripts/build.sh` builds `games/spike` and `games/litspike` into all three trees; existing spike gates stay green on `build/cart`; the dual litspike cart passes `wasm{op:conformance}` and `loadMedia{wgpu:true}` reports `gpu:"webgpu"` on the repaired romdev.

**Verification:** Round-trip test green; three builds succeed; spike gates unchanged; ADR-0001 table regenerated (`gen-pins-table.mjs --check` passes); ADR-0002 written.

- [ ] **Unit 2: Kits, hero profile, first clips, and the density lock**

**Goal:** Pin the Quaternius kits, audit their clips, draft and tune the hero profile, render idle + walk through the pipeline, load it in a new `games/nr` app with the belt camera at 640×360, and produce the first look captures.

**Requirements:** R1, R2, R3, R4, R7, R23

**Dependencies:** Unit 1

**Files:**
- Create: `tools/render/kits.json`, `tools/render/fetch-kits.sh`, `tools/render/audit-clips.py` (Blender script listing action names, frame ranges, bone names per kit → `docs/evidence/combat-slice/clip-audit.md`), `tools/render/profiles/hero.json`, `tools/render/recipes/hero.json`, `games/nr/CMakeLists.txt`, `games/nr/main.c`, `games/nr/anim.c`, `games/nr/anim.h`, `games/nr/assets/roots.txt`, `games/nr/assets/atlases/hero.png|hero-n.png|hero.json`, `games/nr/assets/PROVENANCE.md`, `games/nr/programs/nr.txt|nr_gl.c|nr_wgpu.c`
- Modify: `CMakeLists.txt` (add `games/nr`)
- Test: `games/nr/tests/look-captures.mjs`, `games/nr/tests/input-idle.json`

**Approach:**
- Kits: `kits.json` pins Universal Base Characters, UAL1 and UAL2 (URL, CC0, sha256 computed on first fetch and committed); `fetch-kits.sh` downloads into `deps/kits/` (gitignored) and refuses a digest mismatch or a non-allowlisted licence. The clip audit runs once in Blender and produces the gap table (which of idle, walk, run, hit1–3, jump, jump kick, grab, throw, hurt, knockdown+getup, dash, specials exist by action name); gap clips are the owner's hand-keying list.
- Hero profile: agent drafts `profiles/hero.json` (base body, hair, proportions, outfit parts + neon retexture, clip map from the audit, pose policy); owner tunes it. `nr_render.py` builds the character from the profile over the kit `.blend`. `PROVENANCE.md` records kit URLs/sha256, licence, profile hash, hand-keyed clips (R23).
- `anim.c`: loads `<char>.json`, builds one `t3_plane_geometry` per frame with UVs baked to the frame rect and the pivot at the plane origin; one `standard_material` per character (litspike pattern); clip playback by tick with per-frame durations.
- Camera: fixed-angle perspective, tuned so a 128 px-tall hero fills the design height at the ground line; `pixel_scale 3` on a 1920×1080 logical frame. If the 3D window renderer ignores `pixel_scale`, render to a 640×360 target and blit (decision recorded in ADR-0002).
- Four point lights always present (3 neon + flash slot); `lights_at()` sweep from litspike; the `l0400` state is surveyed here.
- `look-captures.mjs`: drives the part of the R7 capture set that exists at this unit (hero idle under each light, mid-walk, two heroes on different frames) on native and both carts, writing PNGs + a checklist stub to `docs/evidence/combat-slice/`. The belt-scroll and occlusion captures join in Unit 4.
- Prove the non-instanced path: two heroes on different frames and a third on a shared frame, so both `standard+map+nearest+nmap+atest+l0400` and its `instbig` row are reached; lit-side check runs on the non-instanced actor.
- Program survey after first draws; commit tables.

**Patterns to follow:** `games/litspike/main.c` material and lights; `games/spike/main.c` depth ordering and reset-bindings; `docs/solutions/workflow-issues/…programs-survey…`.

**Test scenarios:**
- Happy path: hero idle plays at the manifest's frame durations (frame index in debug state advances on the expected ticks).
- Happy path: lit-side check (litspike `lit-side-check.mjs` adapted) passes on a non-instanced hero under a horizontal AND a vertical light sweep with ratio ≥ 2× over the flat control in both axes.
- Happy path: `cw.three.missing == 0` on native, cart GL and cart WebGPU with both the instanced and non-instanced `l0400` rows reached.
- Edge case: two heroes on different frames render distinct frames in one scene (per-frame geometry proof).
- Edge case: hero at the far left and far right of the belt is undistorted (silhouette width within 2 px of centre).
- Integration: native screenshot shows 3× nearest upscale (pixel runs of exactly 3); each cart host's output size matches the expectation recorded for it (host-scaled low-res frame or cart-scaled 1080p).

**Verification:** Owner reviews the capture set via romdev livestream and the PNGs; density and lighting marked locked in ADR-0002 once approved. The camera lock waits for Unit 4's occlusion and scroll captures. This is the first look-gate checkpoint.

- [ ] **Unit 3: Full hero clip set and atlas budget**

**Goal:** Render all twelve hero clips, measure render time and atlas size, and fix the per-clip frame counts and atlas budget.

**Requirements:** R8, R10, R19, R20

**Dependencies:** Unit 2

**Files:**
- Modify: `tools/render/recipes/hero.json`, `games/nr/assets/atlases/hero.*`, `games/nr/anim.c` (clip table), `docs/decisions/0002-render-pipeline-and-look.md` (budget), `docs/evidence/combat-slice/README.md` (render time, atlas size per clip)
- Test: `games/nr/tests/clips-check.mjs`

**Approach:**
- Clips: idle, walk, hit1, hit2, hit3, jump, jumpkick, grab, throw, hurt, knockdown, special_knockback, special_dash (two specials → 13 clips; R8's twelve counts the specials as one slot).
- Start from the research estimate; measure sheet size at 2048² RGBA8 pages (16 MiB each). Budget: all atlases (colour + normal, three characters) under 64 MiB of wasm memory, set here from the hero's measured cell size plus a per-enemy allowance (grunt ≈ 25 % of hero frames, heavy ≈ 35 %); Unit 6 re-verifies the total.
- Record render wall-clock per clip to answer the hi-bit cost question from the origin.

**Patterns to follow:** Unit 1 pipeline; `games/spike/tests/pak-manifest.mjs` for payload hashes.

**Test scenarios:**
- Happy path: every clip in the manifest has ≥ 4 frames and a pivot inside its rect.
- Happy path: full-set render twice → identical manifest + sheet hashes.
- Edge case: a clip exceeding one page → packer places it on page 2 and the manifest records the page index.
- Error path: a frame's normal sheet rect differs from its colour rect → `post.mjs` fails with the frame named.

**Verification:** Hero set committed; atlas budget, per-enemy allowance and hero frame counts written into ADR-0002; render-time table in evidence.

- [ ] **Unit 4: Arena block and lights**

**Goal:** Build the one street block: ground, 3D storefronts and pillars with parallax, four animated neon lights, scrolling camera with clamp and leash.

**Requirements:** R2, R5, R6, R18 (camera half)

**Dependencies:** Unit 2

**Files:**
- Create: `games/nr/arena.c`, `games/nr/arena.h`, `games/nr/assets/arena/` (generated geometry via a committed script or small glTFs with provenance), `games/nr/assets/arena/lights.json`
- Modify: `games/nr/main.c` (camera follow/clamp/leash), `games/nr/programs/*`
- Test: `games/nr/tests/input-scroll.json`, `games/nr/tests/ordering-check.mjs` (adapted from spike)

**Approach:**
- Geometry: MeshStandardMaterial (no map) storefront boxes and pillars at two depths behind the play lane plus a backdrop plane; emissive strips for neon signs.
- Lights: `lights.json` drives colour, position, flicker/sweep pattern per light; deterministic via `cw_sincos`.
- Camera: follows players' midpoint; clamps so both remain in frame; soft wall one screen ahead of the trailing player; never scrolls back past the current wave's left bound.
- Occlusion: actors and arena geometry share the ground-y depth mapping; pillar in the play lane proves AE6.
- Look captures: add the full belt scroll and the pillar occlusion frames to `look-captures.mjs`; camera angle/FOV tuned against them and then locked in ADR-0002.

**Patterns to follow:** spike `depth_z()` and `ordering-check.mjs`; bomberdude `world.c` for simple generated 3D set pieces.

**Test scenarios:**
- Happy path: scrolling right over 600 frames shows parallax (storefront pixel displacement < actor displacement by a measurable ratio).
- Happy path: AE6 occlusion — pillar occludes the hero behind it, grunt in front occludes the pillar; reversed-depth control fails.
- Happy path: AE4/AE8 — trailing player at the left edge stops scroll; leading player stops at the soft wall one screen ahead.
- Edge case: both players at the same x → camera centres on them with no jitter (x unchanged across 60 idle ticks).
- Integration: `cw.three.missing == 0` with lights sweeping over the full belt on cart GL and WebGPU.

**Verification:** Look captures regenerated with the arena (now the full R7 set minus enemies); owner review via livestream; camera locked in ADR-0002; program tables committed.

- [ ] **Unit 5: Combat core — hero moveset and hit resolution**

**Goal:** Deterministic simulation for one or two heroes: movement, combo, jump/jump-kick, grab/throw, hurt, knockdown, special variants, with hitboxes and reactions.

**Requirements:** R8, R9, R10, R17

**Dependencies:** Unit 3 (clips), Unit 4 (arena bounds)

**Files:**
- Create: `games/nr/sim.c`, `games/nr/sim.h`, `games/nr/tests/input-combat.json`, `games/nr/tests/sim-check.mjs`
- Modify: `games/nr/main.c` (drive sim, map states to clips), `games/nr/anim.c` (state→clip, facing flip via negative x scale on the plane)
- Test: `games/nr/tests/sim-check.mjs`

**Approach:**
- Actor struct: pos (x, ground-y), jump height/velocity, facing, state + state tick, hp, hitbox/hurtbox AABBs per state frame (data table), team.
- States with startup/active/recovery tick counts; combo chains on attack press during recovery window; jump-kick while airborne; grab on contact with a grabbable enemy; throw moves the grabbed actor along an arc; hurt and knockdown with invuln (action2d numbers as seeds).
- Hits resolve team-filtered (no friendly fire); knockback as a per-tick velocity decay.
- A static test dummy actor (enemy team, configurable hp and grabbable flag, no AI) stands in for enemies until Unit 6.
- Debug whitelist: all actor pos/jump/state/hp, rng cursor, wave index, lives, camera x, ticks, input count, rolling checksum.

**Execution note:** Implement hit resolution test-first with scripted inputs; the checksum is the oracle.

**Patterns to follow:** `games/action2d/actors.c` (hitbox windows 9 active/18 cooldown, knock 8 ticks, invuln 60); chromite `sim.c` AABB; spike checksum folding.

**Test scenarios:**
- Happy path: hit1→hit2→hit3 chains when attack is pressed within the recovery window; a late press restarts at hit1.
- Happy path: grab on a grabbable dummy enters throw; the dummy lands at the arc's end and is knocked down; grab on an ungrabbable dummy fails and the hero recovers (AE1 shape, proven on real enemies in Unit 6).
- Happy path: special_knockback pushes every dummy within radius; special_dash moves the hero N units and hits along the path.
- Edge case: two heroes overlapping; one attacks → the other takes no damage (AE7).
- Edge case: jump-kick during descent connects on the first active tick only once per enemy.
- Error path: input shifted by one tick → checksum diverges on the first state field (control for the gate).
- Integration: the same `input-combat.json` twice → byte-identical whitelist + checksum.

**Verification:** `sim-check.mjs` green; determinism control fails as required; both players' actions visible in state.

- [ ] **Unit 6: Enemies, waves, lives, targeting**

**Goal:** Grunt and heavy behaviour, spawn schedule for four waves, shared lives with respawn, alternate target assignment.

**Requirements:** R11, R12, R13, R21, R22, R9 (heavy half)

**Dependencies:** Unit 5; grunt and heavy clip sets (owner-tuned `profiles/grunt.json` and `profiles/heavy.json` over the same kits per R23 — Regular base with different proportions, outfit and palette for the grunt; Superhero base widened with armour parts for the heavy)

**Files:**
- Create: `tools/render/recipes/grunt.json`, `tools/render/recipes/heavy.json`, `games/nr/assets/atlases/grunt.*`, `games/nr/assets/atlases/heavy.*`, `games/nr/waves.c`, `games/nr/waves.h`, `games/nr/tests/input-waves.json`
- Modify: `games/nr/sim.c` (enemy AI, targeting, lives), `games/nr/assets/PROVENANCE.md`
- Test: `games/nr/tests/sim-check.mjs` (extend)

**Approach:**
- Waves 4 / 6 / 6+heavy / 8+heavy from a seeded schedule (chromite pattern); a wave ends when all its enemies are dead; wave 2's end triggers the upgrade (Unit 7).
- Grunt: chase assigned player, attack when in range, 2 hp, 4 clips. Heavy: slow chase, high hp, unthrowable (grab fails: hero recovers), staggered only by the special, 5 clips.
- Targeting: alternate assignment on spawn among present players; retarget on target death/leave.
- Lives: 3 per player present at the title, shared pool; dead player respawns at the camera edge while lives remain; game over at zero. Start presses at game over are refused.
- Pad disconnect (`CW_EVENT_PAD_REMOVED` / `connected` false) mid-fight: the hero finishes its current state, then holds idle and is invulnerable and untargetable; a pending grab releases its target; lives are untouched; reconnecting the same pad resumes control.

**Patterns to follow:** chromite `script.c`/`sim.c`; action2d chase radius and contact damage.

**Test scenarios:**
- Happy path: with two players, 6 spawned grunts are assigned 3/3; killing player 2's target reassigns nothing, player 2 dying reassigns its grunts to player 1.
- Happy path: grab on a heavy fails and the hero recovers in the stated ticks (AE1 heavy half); special staggers the heavy.
- Happy path: wave 3 does not begin until wave 2's last enemy dies.
- Edge case: solo play → all enemies target player 1; pool is 3 lives.
- Edge case: respawn at camera edge places the player inside the clamp bounds.
- Error path: lives reach 0 → state machine enters game over and the sim stops advancing actors; a start press is refused.
- Edge case: pad 2 disconnects mid-combo → hero finishes the hit, idles invulnerable, its grunts retarget to player 1; reconnect resumes.
- Integration: full four-wave scripted run → identical checksum across two native runs.

**Verification:** `sim-check.mjs` green across waves; grunt/heavy atlases committed with provenance; program tables unchanged or recommitted.

- [ ] **Unit 7: Title, join, upgrade choice, end screens, audio**

**Goal:** The flow around the fight: title with join, mid-fight join, upgrade pause and choice, arena-clear and game-over screens, HUD, and sound effects.

**Requirements:** R14, R15, R16, R18 (join half), F1, F2

**Dependencies:** Unit 6

**Files:**
- Create: `games/nr/ui.c`, `games/nr/ui.h`, `games/nr/assets/audio/*.wav` (generated or CC0 with notices), `games/nr/tests/input-2p-full.json`, `games/nr/tests/input-join-mid.json`, `games/nr/tests/input-upgrade.json`
- Modify: `games/nr/main.c`, `games/nr/sim.c` (upgrade variant, join)

**Approach:**
- `game.state` machine (bomberdude pattern): title → fight → upgrade → fight → clear | gameover. HUD: lives, wave, player tags; all strings prewarmed.
- Join: at title via start on any connected pad (derby pattern); mid-fight via start on an unused pad → spawn at camera edge, add lives, targeting includes the new player.
- Upgrade: pause; two variants shown; first press wins (lower port on the same frame); a joiner during pause receives the chosen variant; variant persists to arena end.
- Audio: hit, grab/throw, special, hurt, UI confirm; per-sound `max_voices` caps; `sfx_tick` debug values.

**Patterns to follow:** bomberdude `main.c` draw_title/draw_hud/draw_pause; derby join; spike audio.

**Test scenarios:**
- Happy path: AE2 — player 2 picks dash at the upgrade; both heroes' specials are dash until arena end.
- Happy path: AE3 — pad 2 start mid-fight spawns player 2 at the camera edge; enemies begin splitting.
- Edge case: both players press on the same frame → lower port's choice applies.
- Edge case: player joins during the upgrade pause → gets the chosen variant, no second prompt.
- Error path: start on pad 2 when already joined → no duplicate player.
- Integration: title → four waves → clear with two scripted pads produces a stable final checksum; the HUD glyph bake count is 0 after frame 0.

**Verification:** Full two-player scripted run completes to the clear screen natively; HUD/screens visible in captures; audio `sfx_tick` values present.

- [ ] **Unit 8: Gates, perf, romdev session, evidence**

**Goal:** Close both gates: look captures on native + cart judged by the owner; cross-host brawler gate with recalibrated image tolerance; perf at wave-4 counts; romdev session and livestream; evidence README.

**Requirements:** Look gate, brawler gate, R4 perf re-measure, R7

**Dependencies:** Unit 7

**Files:**
- Create: `games/nr/tests/romdev-session.mjs`, `games/nr/tests/controls.mjs`, `games/nr/tests/perf-native.mjs`, `games/nr/tests/capture-hosts.mjs`, `games/nr/tests/chromium-wgpu.mjs`, `games/nr/tests/goldens.json`, `docs/evidence/combat-slice/README.md` (+ PNGs, states, perf JSON)
- Modify: `tests/gates.json` (nr entries per host incl. WebGPU cart; strict and controls tool gates), `docs/decisions/0002-render-pipeline-and-look.md` (final), `docs/brainstorms/2026-10-24-combat-slice-requirements.md` is not modified; the plan's status flips

**Approach:**
- Gates: `input-2p-full`, `input-waves`, `input-combat`, `input-join-mid`, `input-upgrade` × romdev GL, Chromium GL (via `gate.mjs`) and Chromium WebGPU, romdev WebGPU (via `capture-hosts.mjs` + `chromium-wgpu.mjs`, because `run-cart.mjs --gpu webgpu` cannot run on macOS) → native; whitelist + checksum exact; image tolerance recalibrated on the lit scene with the spike's method (known-good repeats, known-bad blank/colour-space/one-frame-early; floor 0.0005; accept if ≤ half bad min).
- Brawler-gate predicate, beyond cross-host equality: final `game.state == clear`, wave index 4 reached, both scripted players alive at clear, and the final checksum equals the committed golden in `goldens.json` for each script.
- Controls (each must fail its own predicate): row removed, blank, wrong colour space, 0×0, non-finite field, one-tick input shift, light count changed (missing-state).
- Perf: native p99 at the wave-4 on-screen count (8 grunts + heavy + 2 heroes + arena + 4 lights) with actors on distinct frames so the real non-instanced draw pattern is measured, 120 warm-up + 600 measured, vsync off; budget 16.6 ms; busy-loop control. Cart hosts recorded.
- romdev: one session; `loadMedia` dual cart (GL and WebGPU runs), conformance, scripted two-player run with load-frame accounting, screenshots, debugState; `host{op:play, seconds:60}` of the fight for the livestream.
- Look gate: R7 capture set on native and cart with the checklist filled by the owner; captures kept under `docs/evidence/combat-slice/`.

**Patterns to follow:** spike `controls.mjs`, `gate-strict.mjs`, `calibrate.mjs`, `perf-native.mjs`, `romdev-session.mjs`; litspike `capture-hosts.mjs`, `chromium-wgpu.mjs`.

**Test scenarios:**
- Happy path: every nr gate passes on every host; whitelist identical and the golden checksum matched for every script; `game.state == clear` at the end of `input-2p-full`.
- Happy path: native p99 ≤ 16.6 ms at wave-4 count; busy-loop control exceeds it.
- Error path: each control fails exactly its predicate with unrelated gates green.
- Edge case: a tick-counter-only change passes the image predicate.
- Integration: romdev session ends at the expected tick with state byte-equal to native; WebGPU run reports `cw.gpu.api` 2.

**Verification:** Both gates recorded as met or not met with evidence; owner checklist signed in the evidence README; plan `status: completed`.

## System-Wide Impact

- **Interaction graph:** `tools/render` → atlases → `anim.c`; `sim.c` → `anim.c`/`main.c`; engine runners and `programs.mjs` drive verification. `scripts/build.sh` target rename affects every later build.
- **Error propagation:** pipeline fails fast with exit codes and named frames; gates fail with the control that proves them; missing program states surface as `cw.three.missing`.
- **State lifecycle risks:** atlas pages never shrink (load all at start); per-frame geometries are allocated once; join/upgrade state transitions are the main branching surface — covered by scripted runs.
- **Unchanged invariants:** `games/spike` and `games/litspike` keep building and gating; engine and three.c pins unchanged; `.context/` untracked.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Plane-space normal encoding wrong (flipped channel, basis mismatch) | Flat-plane control recipe; lit-side check against the light sweep in Unit 2 before any production art |
| `pixel_scale` ignored by the 3D window renderer | Unit 2 check; fallback render-to-texture, recorded in ADR-0002 |
| Hi-bit art cost exceeds the slice | Unit 3 measures render time and atlas size on one full hero set before grunt/heavy start; frame counts cut to budget |
| Kit clip libraries lack grab/throw, jump kick, knockdown+getup or dash | Unit 2 clip audit produces the gap table before any profile work; gaps are hand-keyed in Blender or derived (dash from sprint, knockdown from death + reversed getup) and pinned as `.blend` actions |
| Kit rig mismatch between UAL1 v2.0 naming and UBC armature | Audit records bone names per kit; one retarget map in the profile if they differ |
| Cross-machine render hashes differ | Reproducibility defined on the pinned CPU path on one machine class; other machines compared by image tolerance |
| Non-instanced draw path and `l0400` state unproven (the lit spike measured one instanced `l0300` draw) | Unit 2 reaches both rows with `cw.three.missing == 0` and re-runs the lit-side check on a non-instanced actor; Unit 8 perf uses distinct frames per actor |
| Blender macOS asset is a `.dmg`, not a tarball | `fetch-deps.sh` gains a dmg path (attach, copy, detach) with the same sha check and staging |
| Light count change creates a new program state | Fixed 4 lights, intensity 0 when unused |
| cart-wgpu replaces cart and something GL-only breaks | Dual cart runs GL under `wgpu:false`; spike gates re-run against it in Unit 1 |
| romdev WebGPU needs the native-dawn repair on a fresh install | Documented in `docs/solutions/`; preflight reports `gl_module_loads`; add a webgpu-loads field |

## Documentation / Operational Notes

- ADR-0002 is the look/pipeline authority; ADR-0001 gains the cart-wgpu and Blender pins.
- `games/nr/assets/PROVENANCE.md` and `LICENSE-NOTICES.md` are required for every asset.
- `docs/evidence/combat-slice/README.md` carries both gate verdicts and the owner's look checklist.

## Sources & References

- **Origin document:** `docs/brainstorms/2026-10-24-combat-slice-requirements.md`
- `docs/evidence/lit-sprite-spike/README.md`, `docs/evidence/shipping-path-spike/README.md`
- `monteslu/cartwheel-engine@v0.15.1`, `monteslu/three.c@c5f840b`, `monteslu/cartwheel-examples@8b6d18d`, `marcusrbrown/panthea@9556db8`
- Blender 4.5 manual (color management, passes, normal map node, baking); NVIDIA mipmapping normal maps; TexturePacker CLI docs; PlayStation Blog SoR4 interview (2020)
- Research lanes recorded in this session (2026-10-24)
