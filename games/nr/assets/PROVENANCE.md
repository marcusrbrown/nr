# nr asset provenance

## atlases/hero.png, hero-n.png, hero.json

Rendered by `tools/render/render-all.sh hero` from `tools/render/recipes/hero.json` and `tools/render/profiles/hero.json`
under Blender 4.5.15 (build `5afeabba6097`, `scripts/deps.lock`), installed with `INSTALL=games/nr/assets/atlases`.
The manifest `hero.json` records the recipe, profile and per-frame payload hashes.

| Input | sha256 |
| --- | --- |
| `tools/render/recipes/hero.json` | `13af28929f0d17f68cebd5ae6ad0efb5db1070e4b90d1d8463384585f1d298d3` |
| `tools/render/profiles/hero.json` | `ecef1347ea52e6b977b3cc804ecf1359f115cc8be4e99cea94c17c92ceff33b6` |
| `atlases/hero.png` | `920b7ca292249feed69485f72cf249cd21afdb9d0ada6f4190d6f83db5f083f7` |
| `atlases/hero-n.png` | `31a68391ac36877f5d5e66e611b9fd41a0aaf6fadeca668603daac4232b722f6` |
| `atlases/hero.json` | `45cb1b49513383e59daed2d14485393eb6eaaf457c89d70fca078ac52b996ee5` |

The atlas holds 14 clips and 96 frames on one 1920x1280 page per sheet: idle, walk, run, hit1, hit2, hit3, jump, throw,
hurt, knockdown, getup, dash, special_knockback and special_dash. Rendered twice from this recipe and profile, the
manifest and both sheets are byte-identical (`docs/evidence/combat-slice/unit3/reproducibility.json`).

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

Actions used, by file: `UAL1_Standard.glb` for idle, walk, run, hit1, hit2, jump, hurt and dash (`Idle_Loop`,
`Walk_Loop`, `Jog_Fwd_Loop`, `Punch_Jab`, `Punch_Cross`, `Jump_Start`/`Jump_Loop`/`Jump_Land`, `Hit_Chest`,
`Sprint_Loop`) and for special_knockback (`Spell_Simple_Enter`/`Shoot`/`Exit`); `UAL2_Standard.glb` for hit3
(`Melee_Hook`, `Melee_Hook_Rec`), throw (`OverhandThrow`), knockdown (`Hit_Knockback`), getup (`LayToIdle`) and
special_dash (`Slide_Start`/`Loop`/`Exit`). `UAL2_Standard_RM.glb` (root motion) and `Mannequin_F.*` are pinned and
audited, not used.

## Hand-keyed and derived clips

Hand-keyed: none yet. `jumpkick` and `grab` are placeholder entries in `tools/render/profiles/hero.json` (not ready, no
segments, a `handKey` note naming the pose sources) and gap slots in the clip table in `games/nr/anim.c`; the renderer
refuses them and the atlas has no frames for them. The owner hand-keys them in Blender and pins the actions as `.blend`
files.

Derived from library actions (the owner's accepted picks, `docs/evidence/combat-slice/clip-audit.md`): special_knockback
is the three Spell_Simple actions in sequence; special_dash is the three Slide actions in sequence; hit3 is
`Melee_Hook` followed by `Melee_Hook_Rec`; jump is take-off, air loop and landing in sequence. hit1, hit2 and dash are
single library actions standing in for a role the kits do not name.

Colours, hair choice, proportions, the height-band painting and the attachments (belt, buckle, pauldrons, baggy
trouser legs, knee pads, pocket, back pack and band) are the profile's, drafted by the implementing agent and tuned
from the owner's Unit 2 review notes; they remain open to tuning. The pose anchor is the pelvis (`pose.anchor`), so a
figure lying down stays inside its cell on both sides of the plane origin.
