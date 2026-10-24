---
title: three.c loses depth state after a render2d pass unless t3_renderer_reset_bindings runs
date: 2026-10-24
category: runtime-errors
module: games/spike
problem_type: runtime_error
component: tooling
symptoms:
  - "From the second frame on, the ground plane and environment mesh are painted over the sprite actors"
  - "Sampled ground pixel reads the ground colour where an actor should be visible"
root_cause: wrong_api
resolution_type: code_fix
severity: high
tags: [three-c, cartwheel, render2d, depth-test, gl-state, hud]
---

# three.c loses depth state after a render2d pass unless t3_renderer_reset_bindings runs

## Problem
Mixing a three.c 3D scene with Cartwheel's `render2d` HUD in one frame: after the HUD pass, the next frame's 3D render draws with stale GL state, so depth testing is effectively off and the ground covers the actors.

## Symptoms
- Frame 1 correct; frame 2 onward the ground and pillar occlude every actor (`out/unit3/noreset.png`).

## What Didn't Work
- Reordering draw calls or setting `renderOrder`: `renderOrder` does not override depth testing and the state loss happens between frames.

## Solution
Call `t3_renderer_reset_bindings(renderer)` before every 3D render (`games/spike/main.c:392`):

```c
t3_renderer_reset_bindings(S.renderer); /* the last frame's HUD pass changed GL state three.c caches */
t3_renderer_render(S.renderer, S.scene, S.camera);
cw_render2d_begin(...); /* HUD */
```

## Why This Works
three.c caches bound GL state and only re-emits what it believes changed. `render2d` modifies that state (depth test, blend, program, VAO) outside three.c's view; the reset invalidates the cache so the next render re-applies the correct state.

## Prevention
- Any frame that interleaves three.c with another renderer calls the reset first.
- The ordering gate (`games/spike/tests/ordering-check.mjs`) samples occlusion pixels and fails if depth is wrong; the reversed-depth control proves it can fail.

## Related Issues
- `docs/evidence/shipping-path-spike/README.md:131`
