# nr asset provenance

## atlases/hero.png, hero-n.png, hero.json

Rendered by `tools/render/render-all.sh hero` from `tools/render/recipes/hero.json` and `tools/render/profiles/hero.json`
under Blender 4.5.15 (build `5afeabba6097`, `scripts/deps.lock`), installed with `INSTALL=games/nr/assets/atlases`.
The manifest `hero.json` records the recipe, profile and per-frame payload hashes.

| Input | sha256 |
| --- | --- |
| `tools/render/recipes/hero.json` | `6ad47b52556f31a241dda759e00ee9e622e74a0e4d9319a32984ace65391fedf` |
| `tools/render/profiles/hero.json` | `6a4f3428371c2b19dbc9033b828c261cbb5d8afa75ce66932bfb088a6bc5b49f` |
| `atlases/hero.png` | `9d708e617c69e0e3219752472fd2f9ac59fce5ab414c43bea2294dd259974391` |
| `atlases/hero.json` | `949644fe1d24320ebb6cb18d67fd2a83b478440ae895c19cb5dd5ccfc0f5bb03` |

Changing the profile changes its hash; `tools/render/pin-profile.mjs` re-pins the recipe, and the atlas is re-rendered.

## Kits

Models and animation by Quaternius, CC0 1.0 Universal (public domain dedication,
https://creativecommons.org/publicdomain/zero/1.0/). The kits are not redistributed in this repository: `deps/kits/`
is gitignored and filled by `tools/render/fetch-kits.sh`, which refuses a licence outside the allowlist (CC0-1.0 only)
and any file whose sha256 differs from `tools/render/kits.json`. The rendered sprites are derived works of CC0 material.

| Kit | Source | Files used | sha256 |
| --- | --- | --- | --- |
| Universal Base Characters [Standard] | https://quaternius.com/packs/universalbasecharacters.html (download: https://quaternius.itch.io/universal-base-characters) | `Superhero_Male_FullBody.gltf`, `.bin` | `e7fcea214ecf...` (gltf), `459003f97458...` (bin); full digests in `kits.json` |
| | | `Hair_SimpleParted.gltf`, `.bin` | `fe0f354d7f95...`, `ecd7c81959f3...` |
| | | licence `License_Standard.txt` | `0f4beaf0fe360a7732e58bbe3dbf60a2422367fbea60cb9ea4add968f383268e` |
| Universal Animation Library [Standard] | https://quaternius.com/packs/universalanimationlibrary.html (download: https://quaternius.itch.io/universal-animation-library) | `UAL1_Standard.glb` | `69591853d817...`; full digest in `kits.json` |
| | | licence `License.txt` | `6d01f55c6e4c49a2c9963e147e561945ae2c83958c8ca667d90a6bffdbfac061` |

Universal Animation Library 2 is listed in `kits.json` and not yet downloaded; nothing in this directory uses it.

## Hand-keyed and derived clips

None. The atlas holds `idle` (`Idle_Loop`) and `walk` (`Walk_Loop`), both library actions. The profile's other clips are
mapped to library actions (substitutes) or marked gaps awaiting hand keys; see `docs/evidence/combat-slice/clip-audit.md`.
Colours, hair choice, proportions and the belt, visor and chest-stripe attachments are the profile's, drafted by the
implementing agent and awaiting the owner's tuning.
