---
title: Generating three.c program tables for an out-of-tree Cartwheel project with programs.mjs
date: 2026-10-24
category: workflow-issues
module: build
problem_type: workflow_issue
component: tooling
severity: medium
applies_when:
  - "A Cartwheel SDK project (not inside the engine tree) adds or changes a three.c material or render state"
  - "cw.three.missing is non-zero on a cart build"
tags: [cartwheel, three-c, programs-mjs, shader-table, cw-programs, out-of-tree]
---

# Generating three.c program tables for an out-of-tree Cartwheel project with programs.mjs

## Context
SDK builds have no runtime shader builder: every three.c material/state combination must be in a committed program table (`programs/<app>.txt` + generated `<app>_gl.c` / `<app>_wgpu.c`, linked via `PROGRAMS`), or the draw is skipped. The engine's `tools/programs.mjs` has three branches; its `--gates` survey reads the engine's own `tests/gates.json` and build dir and ignores `CW_PROJECT_ROOT`, and its run branch starts the binary with no input, so neither covers a project's real scene.

## Guidance
1. Run the app through `run-cart.mjs` with `CW_PROGRAMS_LOG_DIR=<dir>` set, with inputs that reach every material/state (jump, HUD, both players, every actor count). Cart hosts log no program states; the survey takes their `cw.three.missing_states` from the run state instead.
2. Generate from those logs, pointing `--build` at the NATIVE tree (it holds `apps/<app>.json` and the capture cache; the cart tree has neither):

```sh
CW_PROJECT_ROOT=$PWD CW_TEST_GPU=desktop CW_PROGRAMS_LOG_DIR=out/proglogs \
  node deps/cartwheel-engine/tools/run-cart.mjs spike --host native --frames 300 --input games/spike/tests/input-2p.json
node deps/cartwheel-engine/tools/programs.mjs spike spike_stress --no-run --logs out/proglogs --build build/native
node deps/cartwheel-engine/tools/programs.mjs --table games/spike/programs/spike.txt --build build/native   # regenerate C
```

3. Commit the manifest and both C tables. cmake needs the manifest file to exist before the first configure; seed it with a comment line.
4. Publish `cw.three.missing` from the app (`t3_renderer_generated_missing`): a bare three.c renderer has no pipeline, so the engine's own field is absent and a gate on it would pass vacuously.

## Why This Matters
Untabled states draw nothing on cart hosts and the failure is silent without the count. The survey only sees states the input actually reaches.

## When to Apply
- After adding a material, texture filter, alpha test, light count or instancing change.
- Before judging any scene visually.

## Examples
`games/spike/programs/spike.txt` holds `basic+map+nearest+atest`, `basic+map+nearest+instbig+atest`, `standard+l1000`. The row-removal control (`tests/gates.json` → `spike-controls`) rebuilds without `standard+l1000` and expects `cw.three.missing == 1`.

## Related
- `docs/evidence/shipping-path-spike/README.md:119` and `:184-187`
