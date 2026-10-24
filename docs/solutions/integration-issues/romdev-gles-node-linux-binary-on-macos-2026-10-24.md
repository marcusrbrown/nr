---
title: romdevtools 0.150.2 lacks the macOS GL and WebGPU native addons, so wasmcart carts fail to load or fall back to GL
date: 2026-10-24
category: integration-issues
module: romdev
problem_type: integration_issue
component: tooling
symptoms:
  - "loadMedia of any wasmcart GL cart returns: romdev requires headless GL for wasmcart GL carts, but webgl-node/native-gles failed to load"
  - "node -e 'import(\"webgl-node\")' fails with: slice is not valid mach-o file"
  - "file dist/gles.node reports ELF 64-bit LSB shared object, x86-64 on an arm64 Mac"
root_cause: incomplete_setup
resolution_type: environment_setup
severity: high
tags: [romdev, native-gles, native-dawn, webgl-node, webgpu-node, wasmcart, macos-arm64, mise]
---

# romdevtools 0.150.2 lacks the macOS GL and WebGPU native addons, so wasmcart carts fail to load or fall back to GL

## Problem
A freshly installed `romdevtools` 0.150.2 (via mise, `~/.local/share/mise/installs/npm-romdevtools/0.150.2`) answers `/healthz` but cannot load any wasmcart GL cart. Every romdev-dependent step (cart smoke, gates, livestream) is blocked.

## Symptoms
- `POST /tool/loadMedia {platform:"wasmcart"}` → `webgl-node/native-gles failed to load`
- `node_modules/webgl-node/node_modules/native-gles/dist/gles.node` is an x86-64 ELF, not a Mach-O bundle

## What Didn't Work
- Reinstalling the same version reproduces the problem: the package's install step does not fetch the Darwin binary.

## Solution
Run native-gles's own release downloader inside the installed package, then restart the server:

```sh
cd ~/.local/share/mise/installs/npm-romdevtools/0.150.2/node_modules/webgl-node/node_modules/native-gles
node scripts/download-release.mjs   # fetches gles.node-v0.7.1-darwin-arm64.tar.gz into dist/
file dist/gles.node                  # Mach-O 64-bit bundle arm64
```

The WebGPU backend has the same gap (`node_modules/native-dawn/dist/` absent; `loadMedia{wgpu:true}` silently falls back to `gpu:"gl"`). Fix it the same way:

```sh
cd ~/.local/share/mise/installs/npm-romdevtools/0.150.2/node_modules/native-dawn
node scripts/install.mjs            # downloads + sha256-verifies dist/darwin-arm64/lib/dawn.node
node -e 'import("webgpu-node")'   # must load
```

Then `bunx romdevtools` again. `scripts/preflight.sh` records `gl_module_loads` in `build/tuple.json` so a regressed install is caught before any cart step.

## Why This Works
`webgl-node` binds `native-gles`, whose prebuilt is selected at install time. The 0.150.2 package carries the Linux x86-64 artifact regardless of host; the downloader picks the right release asset for the running platform. The top-level `node_modules/native-gles` (0.6.1) is also ELF but is not on the load path romdev uses.

## Prevention
- `scripts/preflight.sh` checks the GL module loads and reports it in `build/tuple.json`; treat `gl_module_loads: false` as "repair before any romdev step".
- Verify with one `loadMedia` of a known-good cart before scheduling gate runs.

## Related Issues
- https://github.com/monteslu/romdev/issues/14
- `docs/decisions/0001-engine-and-toolchain-pins.md:54` records the observed install state.
- `docs/evidence/shipping-path-spike/README.md:96` records the repair as first tried in a copy.
