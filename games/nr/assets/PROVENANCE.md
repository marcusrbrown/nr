# nr asset provenance

## atlases/hero.png, hero-n.png, hero.json

Rendered by `tools/render/render-all.sh hero` from `tools/render/recipes/hero.json` and `tools/render/profiles/hero.json`
under Blender 4.5.15 (build `5afeabba6097`, `scripts/deps.lock`), installed with `INSTALL=games/nr/assets/atlases`.
The manifest `hero.json` records the recipe, profile and per-frame payload hashes.

| Input | sha256 |
| --- | --- |
| `tools/render/recipes/hero.json` | `63f809c115f4c8f46b430f38f86c5a16605433288e0a521b10548bf60787b3ac` |
| `tools/render/profiles/hero.json` | `b16a646b353e1ed813ef11237c8a63a6594fee5d45a3d98f2201d325bc02e33e` |
| `atlases/hero.png` | `527b84da35addffbfc44da53f06b2adc010577aa6aeca7315cc49d6c79a73c23` |
| `atlases/hero.json` | `e66a3fd775c13e922c0b7d21986de0cbdee9164d202d512925b9a3ea6152f60f` |

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

| Universal Animation Library 2 [Standard] | https://quaternius.com/packs/universalanimationlibrary2.html (download: https://quaternius.itch.io/universal-animation-library-2) | `UAL2_Standard.glb` (the profile's second animation file; the clip map draws on it for the hook, throw, knockdown, get-up and slide) | `8cee20ab1bc5...`; full digest in `kits.json` |
| | | licence `License.txt` | `6d01f55c6e4c49a2c9963e147e561945ae2c83958c8ca667d90a6bffdbfac061` |

The atlas holds only idle and walk, both UAL1 actions; no frame in it comes from UAL2 yet. `UAL2_Standard_RM.glb` (root motion) and `Mannequin_F.*` are pinned and audited, not used.

## Hand-keyed and derived clips

None. The atlas holds `idle` (`Idle_Loop`) and `walk` (`Walk_Loop`), both library actions. The profile's other clips are
mapped to library actions (substitutes) or marked gaps awaiting hand keys; see `docs/evidence/combat-slice/clip-audit.md`.
Colours, hair choice, proportions, the height-band painting and the attachments (belt, buckle, pauldrons, baggy
trouser legs, knee pads, pocket, back pack and band) are the profile's, drafted by the implementing agent and tuned
from the owner's Unit 2 review notes; they remain open to tuning.
