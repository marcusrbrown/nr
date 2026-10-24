# AGENTS.md

## Layout

- `games/<name>/` — game targets (sources, assets, tests, generated program tables)
- `scripts/` — dependency lock, fetch, preflight, build
- `tests/` — cross-host gate definitions
- `docs/decisions/`, `docs/plans/`, `docs/evidence/` — see `docs/README.md`
- `docs/solutions/` — documented solutions to past problems (toolchain, runners, romdev, three.c), by category with YAML frontmatter (`module`, `tags`, `problem_type`); relevant when working in those areas

## Invariants

- Game code targets `include/cartwheel/*.h` only. `src/platform/` is the engine's sole SDL/wasmcart boundary.
- `.context/` is the owner's untracked notes. Never propose tracking it.
- Done means the change runs natively and as a cart, and a gate proves both agree.
- Report feasibility conflicts with measured evidence and a concrete alternative. Never silently reduce scope.
- Comments state current facts only. No tombstones, no history.

## Verification

- `scripts/preflight.sh` — checks host tools, writes `build/tuple.json`
- `scripts/fetch-deps.sh` — fetches and verifies pinned dependencies into `deps/`
- `scripts/build.sh` — builds; `TARGETS="native cart"` selects targets
- Engine `tools/run-cart.mjs` and `tests/gate.mjs`, run with `CW_PROJECT_ROOT` set to this repo

## Owner interaction

- Pushes, PRs, and releases need explicit approval.
- No CI changes without asking.
