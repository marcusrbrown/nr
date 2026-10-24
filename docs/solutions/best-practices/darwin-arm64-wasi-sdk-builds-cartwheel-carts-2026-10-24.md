---
title: Cartwheel carts build on macOS arm64 with wasi-sdk 33 arm64-macos; no Linux container needed
date: 2026-10-24
category: best-practices
module: build
problem_type: tooling_decision
component: tooling
severity: medium
applies_when:
  - "Building a wasmcart .wasc from a Cartwheel SDK project on an Apple Silicon Mac"
  - "Pinning the cart toolchain in scripts/deps.lock"
tags: [wasi-sdk, cartwheel, wasmcart, macos-arm64, thinlto, deps-lock]
---

# Cartwheel carts build on macOS arm64 with wasi-sdk 33 arm64-macos; no Linux container needed

## Context
Cartwheel v0.15.1's `scripts/deps.lock` and the examples' `fetch-deps.sh` pin `wasi-sdk-33.0-x86_64-linux` and only fetch cart SDKs on Linux x64. The cart SDK ships its libraries as ThinLTO bitcode, which must link with the same clang that produced it (clang 22.1.0). It was unknown whether the Darwin wasi-sdk could consume that bitcode.

## Guidance
Pin `wasi-sdk-33.0-arm64-macos.tar.gz` (published on the wasi-sdk-33 release; sha256 taken from the GitHub release asset digest) and Binaryen 123 arm64-macos in `scripts/deps.lock`; have `scripts/fetch-deps.sh` select them on `Darwin-arm64` and symlink them into `deps/cartwheel-sdk/cart/deps/`. Build with `TARGETS=cart scripts/build.sh`.

Measured: `spike.wasc` and `spike_stress.wasc` link cleanly (24 s clean build), pass `wasm{op:conformance}` in romdev, and the inner `cart.wasm` is byte-identical across rebuilds.

## Why This Matters
A Darwin-native cart build keeps the edit → build → romdev loop on one machine with no emulation. The `linux/amd64` container path remains a documented fallback only.

## When to Apply
- Any new Cartwheel project on Apple Silicon.
- When upgrading the engine pin: re-check that the engine's own lock still names wasi-sdk 33 / clang 22.1.0; a bump changes the bitcode version and this needs re-verifying.

## Examples
`scripts/deps.lock` carries the arm64-macos entry; `docs/decisions/0001-engine-and-toolchain-pins.md` records the toolchain and the Unit 4 amendment with the clang version and cart digests.

## Related
- `docs/evidence/shipping-path-spike/README.md` (Unit 4 section)
