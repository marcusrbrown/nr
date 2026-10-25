# Neon Rebellion

Neon Rebellion is a cyberpunk belt-scroll beat 'em up: Streets of Rage meets Guardian Heroes × Metal Slug. Solo and local two-player play, melee-first, 3D environments with sprite actors.

## Stack

- C17 on the [Cartwheel](https://github.com/monteslu/cartwheel-engine) engine v0.15.1 with three.c
- Targets: native macOS arm64 and a wasmcart `.wasc` cart, built from one source tree
- Dev loop: romdev (local MCP host) for scripted play, frame stepping, and screenshots

## Build prerequisites

- Xcode command-line tools (clang)
- cmake ≥ 3.20
- ninja
- node ≥ 20
- romdevtools (only for the romdev dev loop)

## Licence

Code: MIT (`LICENSE`). Art: CC-BY-4.0 (`LICENSES/CC-BY-4.0.txt`). The Blender render script `tools/render/nr_render.py`: GPL-3.0-or-later (`LICENSES/GPL-3.0-or-later.txt`).

## Docs

See [`docs/README.md`](docs/README.md).
