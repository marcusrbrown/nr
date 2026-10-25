# ADR-0002: Render pipeline and look

## Status

- Pipeline (Blender settings, passes, normal convention, post-processing, manifest, licence split, reproducibility definition): accepted, 2026-10-24, from combat-slice Unit 1.
- Camera, pixel density and lighting: **proposed**. They lock after the Unit 2 density check and the Unit 4 occlusion and scroll captures, and the owner's approval of the look captures. Nothing below marked proposed is a constraint on art production until then.

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
- Atlas budget, frame counts per clip and the per-enemy allowance: set in Unit 3 from a measured hero set.

## Consequences

- Art is reproducible from a recipe and a pinned Blender; a Blender or kit change is a lock change and a re-render with hash comparison.
- Plane-space normals make a sprite's normal map valid only for a plane facing the render camera; a plane tilted in the game differs from the render camera by that tilt, which Unit 2 and Unit 4 account for in the plane geometry.
- The recipe's `model.parts` primitives are the placeholder source; Unit 2 adds the kit and profile input without changing the output contract.
