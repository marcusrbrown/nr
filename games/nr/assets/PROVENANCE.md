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

## atlases/grunt.png, grunt-n.png, grunt.json

Rendered by `tools/render/render-all.sh grunt` from `tools/render/recipes/grunt.json` and `tools/render/profiles/grunt.json` under
Blender 4.5.15 (build `5afeabba6097`, `scripts/deps.lock`), installed with `INSTALL=games/nr/assets/atlases`. The manifest
`grunt.json` records the recipe, profile and per-frame payload hashes.

| Input | sha256 |
| --- | --- |
| `tools/render/recipes/grunt.json` | `692f3760d32545ffc0121e7c00e852a6cc093c19b79928da680438522d2abdd5` |
| `tools/render/profiles/grunt.json` | `62c13d1c9f19c914300230c576d12adcabdd2b753d5bd14108dc2a3555016e74` |
| `atlases/grunt.png` | `83de76247aa2f4de928b569a227c8caac00c550c3eef966f48c6595dbfe52a4d` |
| `atlases/grunt-n.png` | `0adce3ab25877b876f87221b2e8e4f4fd50abf76d510b051591a9a5b760cc82a` |
| `atlases/grunt.json` | `b260ec6fb469533ae3a3eb8d11b018586641f836383b1a42ae1d9754c175bdca` |

Clips (27 frames, one 1920x480 page per sheet, 160x160 cells like the hero's): idle (`Idle_Loop`), walk (`Walk_Loop`), attack
(`Punch_Jab`), hurt (`Hit_Chest`), knockdown (`Hit_Knockback`) and getup (`LayToIdle`). The body is the kit's Superhero
mesh made leaner by the profile (`widthScale` 0.86), with `Hair_Long` and the profile's hoodie, jeans and lime accent; the
pinned base-character files hold no Regular body, so the grunt is on the same body as the hero.

## atlases/heavy.png, heavy-n.png, heavy.json

Rendered by `tools/render/render-all.sh heavy` from `tools/render/recipes/heavy.json` and `tools/render/profiles/heavy.json` under
Blender 4.5.15 (build `5afeabba6097`, `scripts/deps.lock`), installed with `INSTALL=games/nr/assets/atlases`. The manifest
`heavy.json` records the recipe, profile and per-frame payload hashes.

| Input | sha256 |
| --- | --- |
| `tools/render/recipes/heavy.json` | `484b2b6a3743ded1685ec88c86797c7506cf6edd6cee402b87600911d4a670b5` |
| `tools/render/profiles/heavy.json` | `33d4efe173510cfa15412558e76ce35ab2d772aee66412210c3371bebb0b5f3c` |
| `atlases/heavy.png` | `ec22ce77d35f35b79ab5cf20fe3c1db892a6581fe23d83f60f6d78cc27fc6b41` |
| `atlases/heavy-n.png` | `97794c88cd036028ac995a749ea334f402e61670f030bc80fd3858ff3eccb640` |
| `atlases/heavy.json` | `f08189c9e4110f159183b397054aff9204bd4e739a0d53dd8c1222885b20ad5f` |

Clips (27 frames, one 2016x672 page per sheet, 224x224 cells at the hero's 64 pixels per unit): idle (`Idle_FoldArms_Loop`),
walk (`Walk_Loop`), attack (`Melee_Hook` then `Melee_Hook_Rec`), hurt (`Hit_Chest`) and stagger (`Hit_Head`). The body is
the kit's Superhero mesh widened by the profile (`widthScale` 1.55, `depthScale` 1.3), with a helmet, chest plate,
pauldrons, bracers, knee plates and back pack in a dark palette with a red-orange accent, and no hair mesh. The cell is wider
than the hero's because the hook reaches 190 texels from its left edge.

Actions used by the enemies, by file: `UAL1_Standard.glb` for `Idle_Loop`, `Walk_Loop`, `Punch_Jab`, `Hit_Chest` and
`Hit_Head`; `UAL2_Standard.glb` for `Idle_FoldArms_Loop`, `Hit_Knockback`, `LayToIdle`, `Melee_Hook` and `Melee_Hook_Rec`.
Hair for the grunt: `Hair_Long.gltf`, `.bin` (`27e2c63e8f98...`, full digests in `kits.json`). Colours, proportions and
attachments are the profiles', drafted by the implementing agent and open to the owner's tuning.

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
