# ADR-0002: Render pipeline and look

## Status

- Pipeline (Blender settings, passes, normal convention, post-processing, manifest, licence split, reproducibility definition): accepted, 2026-10-24, from combat-slice Unit 1.
- Camera, pixel density and lighting: **proposed**. They are the current values, tuned as the prototype develops: Unit 2 measured the density, Unit 4's occlusion and scroll captures tune the camera, and the owner's review of the look captures sets what is approved for now. Nothing below marked proposed constrains art production beyond the current render.

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
- Lit side: on a non-instanced hero the light-induced swing of the lit-side luminance difference is 3.3x to 3.7x the flat-normal control's on the horizontal sweep and 7.6x to 8.9x on the vertical sweep, on native and cart (`games/nr/tests/lit-side-check.mjs`); its per-frame sign check subtracts the flat control's difference, which carries the albedo offset between the classes.
- Fill light: ambient 0x7482a8 plus the three neons (intensity 28) and a flash slot at intensity 0; the neons still set the colour of the lit side (`solo_*` captures).

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

## Consequences

- Art is reproducible from a recipe and a pinned Blender; a Blender or kit change is a pin change and a re-render with hash comparison.
- Plane-space normals make a sprite's normal map valid only for a plane facing the render camera; a plane tilted in the game differs from the render camera by that tilt, which Unit 2 and Unit 4 account for in the plane geometry.
- The recipe's `model.parts` primitives are the placeholder source; Unit 2 adds the kit and profile input without changing the output contract.
