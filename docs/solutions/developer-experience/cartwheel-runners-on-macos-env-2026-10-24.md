---
title: Environment for Cartwheel run-cart.mjs and gate.mjs on macOS
date: 2026-10-24
category: developer-experience
module: tests
problem_type: developer_experience
component: development_workflow
severity: medium
applies_when:
  - "Running deps/cartwheel-engine/tools/run-cart.mjs or tests/gate.mjs on a Mac"
  - "A runner exits 1 in enterGpuSandbox() or armGuard() before the app starts"
tags: [cartwheel, run-cart, gate-mjs, macos, cw-test-gpu, cw-project-root]
---

# Environment for Cartwheel run-cart.mjs and gate.mjs on macOS

## Context
Cartwheel v0.15.1's runners default to Linux GPU sandboxing: `run-cart.mjs` pins a test GPU from `~/.config/cartwheel/chromium-gpu` and sysfs, and `gate.mjs`'s `armGuard()` looks the GPU up before honouring an opt-out. On macOS both exit 1 with no app output.

## Guidance
Always set `CW_PROJECT_ROOT=<repo>` for an out-of-tree project, then:

| Tool | Environment |
| --- | --- |
| `tools/run-cart.mjs --host native\|chromium\|romdev` | `CW_TEST_GPU=desktop` |
| `tests/gate.mjs` | `CW_TEST_GPU=software CW_WGPU_ADAPTER=apple` |

`software` selects the no-op guard; the GL renderer check then expects the renderer string to contain `CW_WGPU_ADAPTER` (`ANGLE (Apple, Apple M1 Pro, OpenGL 4.1 Metal - 89.4)` on an M1 Pro). The setting name is the engine's; the GPU is the real Metal device. `desktop` does not work for `gate.mjs` because `armGuard()` runs the lookup first.

Other facts: `run-cart.mjs` hard-codes romdev at `http://127.0.0.1:7331` and opens its own session `cartwheel-run-<app>-<pid>`; it defaults native audio to a dummy driver.

## Why This Matters
Without these, every runner fails identically and looks like a build problem.

## When to Apply
- Every local run, gate, program survey and perf measurement on macOS. `scripts/preflight.sh` does not set them; they belong on the command line or in the calling script.

## Examples
```sh
CW_PROJECT_ROOT=$PWD CW_TEST_GPU=desktop node deps/cartwheel-engine/tools/run-cart.mjs spike --host romdev --frames 300 --input games/spike/tests/input-2p.json
CW_PROJECT_ROOT=$PWD CW_TEST_GPU=software CW_WGPU_ADAPTER=apple node deps/cartwheel-engine/tests/gate.mjs
```

## Related
- `docs/decisions/0001-engine-and-toolchain-pins.md:45-46`
