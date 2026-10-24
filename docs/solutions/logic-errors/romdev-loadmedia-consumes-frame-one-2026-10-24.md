---
title: romdev loadMedia runs engine frame 1, so input scripts starting at frame 1 diverge from native
date: 2026-10-24
category: logic-errors
module: tests
problem_type: logic_error
component: testing_framework
symptoms:
  - "Cross-host gate fails romdev→native on spike.input_count (205 vs 206) and spike.checksum while Chromium→native passes"
  - "romdev session: final spike.ticks is one higher than the planned frame count"
root_cause: async_timing
resolution_type: test_fix
severity: medium
tags: [romdev, run-cart, input-script, determinism, frame-accounting, gate]
---

# romdev loadMedia runs engine frame 1, so input scripts starting at frame 1 diverge from native

## Problem
romdev's `loadMedia` steps one engine frame before any input can be applied, and `input{op:sequence}` advances frames as it runs. An input script with a non-neutral entry at frame 1, or a session script that plans "N frames from zero", produces state that disagrees with native and Chromium.

## Symptoms
- Gate `spike-ordering-romdev` failed on `spike.pos[0]`, `spike.input_count`, `spike.checksum`; the Chromium leg of the same script passed.
- A session script that ignores the load frame ends at ticks 301 instead of 300.

## What Didn't Work
- Treating the mismatch as a renderer or determinism bug: positions diverged only by the one missed input tick.

## Solution
1. Input scripts begin with a neutral entry at frame 1; real input starts at frame 2 (`games/spike/tests/input-ordering.json`, `input-2p.json`, `input-stress.json`).
2. Session scripts account for frames already run: after `loadMedia` (`frameCount` 1) and `input{sequence}` (which reports `framesRun`), step only `expected - frameCount` more frames, then assert `spike.ticks == expected` before screenshot/compare. `games/spike/tests/romdev-session.mjs` does this and raises `TickMismatch` otherwise.

## Why This Works
Native and Chromium runners apply the script from frame 1 because they control frame 1; romdev has already executed it at load. Shifting input to frame 2 makes all three hosts see the same input on the same tick, and counting from the host-reported `frameCount` removes the off-by-one.

## Prevention
- Never derive the romdev frame plan from zero; read `frameCount` from the load and sequence responses.
- Keep `spike.ticks` (not raw frame count) in the compared whitelist.
- The gate `spike-controls` includes a one-tick input shift that must fail, proving the gate can see this class of error.

## Related Issues
- `docs/evidence/shipping-path-spike/README.md:251` and `:368-378`
