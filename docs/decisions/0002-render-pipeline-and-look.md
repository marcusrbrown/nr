# ADR-0002: Render pipeline and look

## Status

- Pipeline (Blender settings, passes, normal convention, post-processing, manifest, licence split, reproducibility definition): accepted, 2026-10-24, from combat-slice Unit 1.
- Camera, pixel density and lighting: **proposed**. They are the current values, tuned as the prototype develops: Unit 2 measured the density, Unit 4 checked the camera against its occlusion and scroll captures, and the owner's review of the look captures sets what is approved for now. Nothing below marked proposed constrains art production beyond the current render.
- Final values of the combat slice (section "Final values", Unit 8): measured against the brawler gate, which is met; the look gate is the owner's checklist in `docs/evidence/combat-slice/look/CHECKLIST.md`, not yet filled, so the proposed items stay proposed until it is.

## Context

Neon Rebellion draws actors as pre-rendered sprite frames with normal maps on three.c planes under the arena's neon point lights. Panthea's render route bakes a toon key light into its colour pass and has no normal role, so it cannot supply unlit albedo or normals. nr owns a Blender script that does. Characters will come from pinned CC0 kits through profiles (plan Key Technical Decisions, "Kit route"); Unit 1 renders a primitive placeholder model from the recipe so the whole route runs before any real art.

Plan: `docs/plans/2026-10-24-002-feat-combat-slice-plan.md`.

## Decision

### Route

`tools/render/render-all.sh` runs `nr_render.py` under the pinned Blender (`deps/blender`, ADR-0001) for each recipe in `tools/render/recipes/`, then `post.mjs`. A recipe (`recipe.schema.json`) pins the Blender version and build hash, the cell size, the supersample factor, the camera, the render seed and samples, the model, and the slots (clip, frame count, facing, frame duration).

- Contract borrowed from Panthea's `render.py` as design only: first line `RENDER start`, a `done.json` sentinel written last through a temporary file after the frames directory is moved into place, exit codes 0 ok, 1 uncaught exception, 10 Cycles CPU device unavailable, 11 Blender version or build mismatch (the message names expected and found; no output directory is created), 12 input error (recipe, arguments, an existing output directory).
- Render settings: Cycles on the CPU, seed from the recipe (animated seed off), denoise off, adaptive sampling off, a box pixel filter of width 0.01 (every pixel is one point sample, so alpha is 0 or 1), transparent film, exposure 0, gamma 1, 8-bit RGBA PNG, no dither, render size `cell * supersample` (4 for the control and placeholder recipes).
- Albedo pass: every material is an emission of its colour (unlit), Standard view transform.
- Normal pass: a material override emits the world shading normal's components along the camera's right, up and toward-camera axes (the camera object's world-matrix columns baked into the nodes as constants) encoded `v * 0.5 + 0.5`. It is a data pass: Raw view transform, so the bytes are the encoded values and not sRGB-encoded.
- Not emitted yet: id and depth passes (the plan's Key Technical Decisions name them; nothing in Unit 1 consumes them).

### Normal convention

The sprite plane's basis: R = screen right, G = screen up, B = toward the camera; OpenGL green-up; 0.5 is zero. This is the basis three.c's derivative tangent frame gives a plane facing the camera. Measured with the placeholder at 20 degrees elevation: a vertical face toward the camera encodes (128, 84, 247) (camera-space (0, -0.34, 0.94)); the top cap of the torso cylinder encodes (171, 213, 211). The Blender `Vector Transform` node to camera space returned a negated blue channel (Cycles' internal camera space looks down +Z), which is why the basis is built from the camera matrix instead.

Controls (`tools/render/tests/pipeline-roundtrip.mjs`): the flat-plane recipe's normal sheet is uniform (128, 128, 255) within one level (constancy only: it cannot detect a green flip); the vertical-control sphere has green > 0.5 on every top-facing texel, < 0.5 on every bottom-facing one, falling monotonically down the centre column, red rising left to right, and blue > 0.5 everywhere. The in-engine check that the lit side follows a light swept above and below the sprite needs a sprite sheet in a running app; it is a Unit 2 test on the hero.

### Post-processing and manifest

`post.mjs` downsamples each frame from `cell * supersample` to the cell: colour takes the centre sub-pixel of each block (nearest, no blending) with alpha cut to 0 or 255; the normal takes the unit vectors of the block's opaque sub-pixels, averages them as vectors and renormalises (never colour-averages them); the normal's alpha is the colour's. Transparent texels beside opaque ones then take a neighbour's RGB from both sheets (`atlas.dilate` passes, default 2; alpha stays 0), so filtering and mip-mapping do not pull in black or flat-normal fringes.

Every frame fills one full cell, so a pivot is the same offset in every frame; `pivot` in the manifest is the projection of `camera.pivotWorld` in cell pixels from the frame rect's top-left. Frames lay out row-major in recipe order on pages of at most `atlas.pageSize` (default 2048) square; colour and normal sheets share the layout, and `post.mjs` fails naming the frame or page when a rect leaves its page or the two sheets' sizes differ. A frame with no visible pixel keeps its cell and is marked `empty`.

`<name>.json` carries the frame rects, pivots, durations and page index, the clips (first frame, count, facing, duration, loop), the recipe's sha256, the Blender build, and per-frame input hashes and per-page output hashes. Hashes are over payloads, not files: the PNG hash covers the IHDR and IDAT chunk data because Blender writes a Date text chunk into every PNG; sheets additionally carry `pixelsSha256`, the hash of the raw RGBA bytes. Timing is in the sentinel (`renderMs`), outside the manifest.

### Reproducibility

Reproducible means identical payload hashes (every `pixelsSha256` and `inputs` entry) and an identical manifest on the pinned Blender build on the CPU path, on this machine class (Apple Silicon, macOS 15). Cross-machine equality is measured, not promised; other machines are compared by image tolerance. Measured on the development Mac: the placeholder rendered and post-processed twice yields byte-identical sheets and manifest.

Measured cost, Cycles CPU, 1 sample: the 4-frame placeholder (192x256 supersampled, two passes per frame) renders its slot in about 0.1 s and the process runs in about 1.5 s including Blender's start-up.

### Licence split

`tools/render/nr_render.py` imports `bpy` and is licensed GPL-3.0-or-later (`LICENSES/GPL-3.0-or-later.txt`, SPDX header in the file). It is run as a tool; its inputs and outputs are not covered by it. The game code is MIT, the art CC-BY-4.0 (README). `post.mjs`, the schema, the recipes and the tests do not import Blender and follow the repository's MIT licence.

### Proposed: camera, density, lighting

- Sprite render camera: fixed orthographic camera at 20 degrees elevation, azimuth 0 (placeholder recipe); the game's belt camera is a fixed-angle perspective camera. The elevation, the ortho height that makes a hero 128 px tall, and the plane tilt are tuned in Unit 2 against the 128 px target and in Unit 4 against the occlusion captures.
- Density: 640x360 virtual resolution through `pixel_scale 3` on a 1920x1080 logical frame, hero about 128 px tall. Unit 2 checks that the 3D window renderer honours `pixel_scale` and each cart host's output size; if it does not, a 640x360 render target blitted up replaces it.
- Lighting: four point lights always present (three arena neons and one flash slot, intensity 0 when idle), so one program state (`l0400`) covers the game; Unit 2 surveys it.
- Atlas budget, frame counts per clip and the per-enemy allowance: set in Unit 3 from the measured hero set (below).

### Measured in Unit 2 (current values, open to tuning)

- `pixel_scale` is honoured by the 3D window renderer. `cw_drawable_size()` returns the scene target (640x360) under `.width 1920, .height 1080, .pixel_scale 3`, `cw_render3d_window_renderer` is built at that size, and the engine scales the scene up 3x with nearest filtering. No render-target blit is needed. Measured on the hosts the captures use (`nr.px` in each state, `docs/evidence/combat-slice/unit2/captures.json`): the native binary and the dual cart, both on WebGPU, and the GL state runs of the native binary and the GL cart all report window 1920x1080, drawable 640x360, render 640x360, scale 3, and every picture is 1920x1080; the cart's pictures are pixel-identical to the native's. `games/nr/tests/stage-check.mjs` finds no 3x3 block of the native capture that is not one colour. The engine does the upscale on every host measured, so no cart host presents a low-resolution frame for the host to scale.
- Camera as built in `games/nr/main.c`: perspective, 18 degrees vertical FOV, pitched down 20 degrees (equal to the sprite render camera's elevation), placed so one world unit is 64 scene pixels at the centre lane and the centre lane's ground line is 100 scene pixels below the frame centre. A hero plane is rotated by the camera pitch, so it faces the camera and its plane-space normals are valid. The 128 px idle figure measures 128 +- 3 px in the atlas (`tools/render/tests/hero-profile.mjs`) and the projected atlas alpha overlaps the rendered silhouette at IoU 0.999 to 1.000 on native and cart.
- Per-frame plane geometry (UVs on the frame's rect, one material per character) puts heroes on different frames in one scene; heroes on a shared frame batch into the `instbig` row. Both `standard+map+nearest+nmap+atest+l0400` and its `instbig` row are reached by the stage; the row-removal controls (`games/nr/tests/programs-controls.mjs`) show each removal gives `cw.three.missing == 1` naming exactly that state.
- Lit side: on a non-instanced hero the light-induced swing of the lit-side luminance difference is 9.0x to 9.8x the flat-normal control's on the horizontal sweep and 7.3x to 8.3x on the vertical sweep, on native and cart, facing right and facing left on the mirrored plane (`games/nr/tests/lit-side-check.mjs`, `--facing left`; the Unit 5 run is `docs/evidence/combat-slice/unit5/lit-side-check.txt` and `lit-side-check-left.txt`, against the Unit 3 atlas, which replaced the Unit 2 stand-in the earlier figures came from); its per-frame sign check subtracts the flat control's difference, which carries the albedo offset between the classes.
- Fill light: ambient 0x7482a8 plus the three neons (intensity 28) and a flash slot at intensity 0; the neons still set the colour of the lit side (`solo_*` captures).

### Arena, camera follow and lights (Unit 4, current values, open to tuning)

- Camera angle and field of view stay at the Unit 2 values: pitch 20 degrees (the sprite render camera's elevation, so a tilted actor plane still faces the render camera and its plane-space normals hold), vertical FOV 18 degrees, 64 scene pixels per unit at the centre lane, the centre lane's ground line 100 scene pixels below the frame centre. The scroll and pillar captures were not taken at other angles; these values were checked against them, not chosen from a sweep. Measured with `games/nr/tests/look-lib.mjs` on the 640x360 scene: the ground line of lane -1.6 is at y 239.9, of lane 0 at 280.0, of lane 1.8 at 334.1; the head of a 144 px figure on lane -1.6 is at y 107, so the whole play lane (3.4 units, 94 px of ground) and the figures on it are inside the frame. Scene pixels per unit at the ground: 64.3 at the pillar's front face (z 0.1), 55.9 at the shop fronts (z -2.75), 49.6 at the tower fronts (z -5.5), 34.7 at the skyline (z -16).
- Street block (`games/nr/arena.c`, `assets/arena/layout.json` written by `assets/arena/gen-arena.mjs`, no third-party assets): three screens wide, x -5 to 25, with 112 solids: 53 near (shop fronts with window, door, awning and neon sign strip, and a colonnade on the sidewalk, facade plane z -2.75, 2.7 high), 29 far (tall buildings with window bands and a vertical neon sign, facade plane z -5.5, and piers), 17 backdrop (a sky plane at z -16 and a skyline with window bands), 11 ground (the street and sidewalk, a curb, dashed lane marks) and 2 in the play lane (the pillar and its emissive band). Materials are `MeshStandardMaterial` without a map; windows and signs are emissive. The street and its markings are drawn first and do not write depth, so an actor's feet below its pivot are not cut by them.
- Actors and arena share one depth mapping: an actor's world z is its lane plus `id * 0.004` (`arena_depth_z`), and the arena stands at its own lane. A standing actor's head recedes behind its ground point by its height times the sine of the pitch (2.25 x 0.34 = 0.77 units), so an actor within 0.77 units in front of a solid pushes its head through the solid's front face. `arena_load` therefore widens each blocking solid into a rectangle an actor cannot enter: the footprint plus the actor's half width (0.45) in x, from 0.05 behind the back face to the head's recession in front of the front face. The pillar (x 12, 1.2 x 3.2 x 0.5, front face at z 0.1) blocks x 10.95 to 13.05 and lanes -0.45 to 0.9; actors walk around it behind (lane < -0.45) or in front (lane > 0.9). `games/nr/tests/ordering-check.mjs` proves the occlusion: the actor behind the pillar shows 0 of its 964 overlap pixels, the actor in front 2146 of 2146, and the reversed-depth control build fails both.
- Camera follow (`step_camera` in `games/nr/main.c`, deterministic): it follows the midpoint of the players' x. A player's frame half width at its lane is the frame's half width scaled by the lane's distance from the camera, less the actor's half width: 4.97 (lane -1.6), 4.55 (lane 0), 4.07 (lane 1.8) units. Each tick the players move, each is held inside the frame the camera has, then the camera moves to the midpoint within the range the trailing player (it cannot leave the frame on the left), the leader (on the right) and the furthest scroll allow, at most 0.3 units a tick. The trailing player at the left edge therefore holds the belt, and the leader stops at the soft wall, the right edge of that frame: 9.1 units ahead of the trailing player at lanes 0.6 and -0.6, a little under one screen width (10 units) because the actors' silhouettes stay in frame. The camera never moves back (`cam_left`) and its x range is 0 to 20; actors stand at x -4 to 24. Measured on `input-scroll.json` (`docs/evidence/combat-slice/unit4/scroll-check.txt`): at tick 230 the trailing player is at the left edge, the leader at the soft wall and the camera has not moved since tick 142; two players at one x leave the camera on them with no movement over 60 idle ticks; the camera ends at 20 with both players at x 24.
- Parallax: the camera is a perspective camera, so a layer farther from it shifts less on screen for the same camera move. Camera 4.44 units: the play lane pillar's band shifts 879 screen px, the near shop sign 780 (x0.887), the far tower sign 695 (x0.791); the belt camera predicts 0.885 and 0.787. An actor's world shift for the same move is 4.44 x 64 x 3 = 852 px at the centre lane.
- Lights (`assets/arena/lights.json`, `arena_lights_at`): the ambient fill 0x7482a8 and four point lights, distance 14, decay 2: neons magenta 0xff2bd6, cyan 0x20e8ff and amber 0xffa020 at intensity 28 and a white flash slot at 0. A neon's position is 0.8 x the camera x plus a base (x 2.5, 4.0, 5.5; y 2.4; z 2.4) plus a sine sweep per axis from `cw_sincos` (x amplitudes 4.5, 5.5, 3.5 over 120, 240 and 360 ticks; y and z 0.3 and 0.4), so the lights stay near the screen as the camera scrolls and still sweep the whole street: over the scroll script their x spans -0.7 to 24.8. Intensity flickers by up to 12 to 22 percent (smoothly) and drops to 30 to 50 percent for 2 to 4 ticks every 197, 251 and 313 ticks. `cw.three.missing` is 0 on native WebGPU, cart WebGPU and the GL state runs with the lights over the whole belt.
- Programs: the street block adds `standard+instbig+l0400` (boxes that share a geometry and material draw instanced), so four `l0400` rows cover the game; `games/nr/tests/programs-controls.mjs` shows each removal gives `cw.three.missing == 1` naming exactly that state.

### Atlas budget (Unit 3)

Measured on the full hero set: 14 clips, 96 frames, 160x160 cells, one 1920x1280 page per sheet. Per-clip frame counts,
render times and sheet sizes are in `docs/evidence/combat-slice/README.md`; the checks are `games/nr/tests/clips-check.mjs`
and `tools/render/tests/hero-profile.mjs`.

- Cost of a frame: 160 x 160 x 4 bytes = 100 KiB of decoded RGBA per sheet, 200 KiB for the colour and normal pair.
  `anim.c` keeps one decoded copy of each sheet (`t3_texture.pixels`) and decodes one sheet at a time, so memory is the
  sum of the sheets' decoded sizes plus the largest sheet during a load.
- Budget: all colour and normal sheets of the three characters total at most **64 MiB** decoded, each character on one
  page of at most 2048 x 2048 (144 cells), against the 128 MiB wasm. The engine's `mem_total` is 8.3 MB
  (`docs/evidence/shipping-path-spike/README.md`), so the budget plus the load peak leaves the rest of the wasm to the
  engine, three.c geometry and audio.
- Allowance: the hero is planned at 106 frames (96 rendered plus 5 for the hand-keyed `jumpkick` and 5 for `grab`); the
  grunt is allowed 25 % of that (27 frames, 5 clips) and the heavy 35 % (38 frames, 5 clips).

| Character | Frames | Page | Pair MiB |
| --- | ---: | --- | ---: |
| hero (96 now, 106 planned) | 96 / 106 | 1920x1280 / 1920x1440 | 18.75 / 21.09 |
| grunt | 27 | 1920x480 | 7.03 |
| heavy | 38 | 1920x640 | 9.38 |
| total, planned | 171 | | 37.50 |

Re-verified in Unit 6 with the three atlases installed (`games/nr/tests/enemies-check.mjs`, `docs/evidence/combat-slice/unit6/`):
the grunt is 27 frames of 160x160 on a 1920x480 page (7.03 MiB), the heavy 27 frames of 224x224 on a 2016x672 page
(10.34 MiB; its hook reaches 190 texels from the cell's left edge, which the 160 cell cannot hold), the hero 96 frames
(18.75 MiB). The total is **36.12 MiB** decoded (38.46 MiB with the hero's planned 106 frames) against 64 MiB; the load
peak, one more sheet decoding, is 49.01 MiB. The heavy's cell is 1.96 times the hero's area, so its allowance is by
frames (27 of 38) and its page is the larger of the two enemies'.

The planned total leaves 26.5 MiB of the budget unused; with the largest sheet (10.5 MiB) held during a load the peak is
48.0 MiB. A character past its frame cap or past 144 frames has frames cut, or moves to a second page (the packer places
it there and records the page; the loader reads one page per character today). The frame counts below needed no cut.

- Frame counts per clip are the profile's `proposal` values: idle 8, walk 8, run 8, hit1 6, hit2 6, hit3 7, jump 6,
  throw 6, hurt 4, knockdown 8, getup 6, dash 6, special_knockback 9, special_dash 8. Every clip has at least 4 frames.
  Playback time per clip is `frames x ms` (60 to 250 ms a frame, 320 ms to 2 s a clip).
- Render cost (the origin's hi-bit cost question): Cycles CPU, 1 sample, supersample 4, two passes: 139 ms per frame on
  the development Mac (13.1 to 13.6 s for the 96 frames, about 20 s with Blender's start-up and post-processing). The
  planned hero, grunt and heavy sets (171 frames) are about 24 s of rendering.
- Pose anchor: the hero profile anchors the pelvis at the plane origin (`pose.anchor: pelvis-xy`). A feet anchor put the
  knocked-down body 124 px to one side of the origin, outside a 160 px cell centred on it (the plane mirrors about the
  origin, so the cell is symmetric); the pelvis anchor keeps every frame of the 14 clips within x 15 to 155 and y 20 to 156
  of the cell.
- Reproducibility: the full-set render, post-processed twice, gives identical manifests and identical colour and normal
  sheets (and a third time for the committed install) on this machine.
- Clip table: `games/nr/anim.c` names the hero's 16 clip slots; `jumpkick` and `grab` are gap slots (the profile marks
  them not ready with a `handKey` note, the renderer refuses them with exit 12) until the owner hand-keys them.

## Final values

The values the slice ends on, with what was measured against them (`docs/evidence/combat-slice/README.md` has the tables and the
artifacts). Measured on one machine: Apple M1 Pro, macOS 15.7.9, romdev 0.150.2.

- Camera and density: perspective camera, vertical FOV 18 degrees, pitched 20 degrees (the sprite render camera's elevation), 64
  scene pixels per world unit at the centre lane, the centre lane's ground line 100 scene pixels below the frame's centre; the
  window is 1920x1080 logical with `pixel_scale 3`, a 640x360 scene upscaled by the engine with nearest filtering; the hero's
  idle figure is 128 px. Unchanged since Units 2 and 4.
- Lighting: ambient 0x7482a8 and four point lights (three neons at intensity 28 and a flash slot at 0), distance 14, decay 2, so
  one program state, `l0400`, covers the game; the four `l0400` rows of `games/nr/programs/nr.txt` are all it draws. three.c covers a
  frame with fewer lights than a row's with that row; a fifth light has no row and is a missing state (the gate's light-count
  control). A host that draws a program state without a row fails the gate on `cw.three.missing`.
- Depth: two planes of the arena at one depth with overlapping extents are ordered by the host's tie-break, which differed between
  romdev GL and native (8,037 pixels at the top of the frame); planes that overlap stand at distinct depths (`gen-arena.mjs`,
  the second haze band 0.02 behind the first).
- Atlas: 14 hero clips (96 frames), the grunt (27) and the heavy (27), 36.12 MiB decoded against the 64 MiB budget. Measured in
  cart runs, everything the game touches in the 128 MiB wasm is 46.0 MiB (GL) to 46.5 MiB (WebGPU) at the end of the full game,
  so the budget holds with the whole heap counted. `jumpkick` and `grab` remain gaps for the owner's hand-keyed clips.
- Image tolerance across hosts: 0.0005 of the pixels differing by more than 16 levels, the floor, calibrated on the lit scene by
  the spike's method (good maximum 0 on all four cart-host pairs; smallest bad 0.0025, a frame one early; the bound is at most
  half of that). The hosts' frames were pixel-identical on this machine, so the number is the floor, not a measured spread.
- Frame budget: the wave-4 population (8 grunts, a heavy, two heroes, the street block, four lights, every actor on its own
  frame) renders with GPU work in a p99 of 1.16 ms at worst over 10 native runs, against 16.6 ms; the busy-loop control is 23.7 ms.
  The full game's 2D screens are not in that scene.
- Not settled here: the look. Whether the lit side, silhouettes, occlusion and screens are right is the owner's checklist.

## Consequences

- Art is reproducible from a recipe and a pinned Blender; a Blender or kit change is a pin change and a re-render with hash comparison.
- Plane-space normals make a sprite's normal map valid only for a plane facing the render camera; a plane tilted in the game differs from the render camera by that tilt, which Unit 2 and Unit 4 account for in the plane geometry.
- The recipe's `model.parts` primitives are the placeholder source; Unit 2 adds the kit and profile input without changing the output contract.
