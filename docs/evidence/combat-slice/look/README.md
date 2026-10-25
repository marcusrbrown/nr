# Look gate capture set

The capture set of requirement R7, as one set: 25 captures at 1920x1080 on the native binary on WebGPU (Dawn on Metal, SDL's
offscreen driver, Apple M1 Pro). For each, the same capture on the cart (`build/cart-wgpu` in headless Chromium on WebGPU) gave
identical pixels and an equal whitelisted simulation state (`set.json`; `<name>.json` is the native run's reduced debug state).
`CHECKLIST.md` is the owner's checklist and is not filled in.

Regenerate: `CW_TEST_GPU=desktop node games/nr/tests/look-set.mjs`.

| File | Shows | App, input, tick | Cart vs native |
| --- | --- | --- | --- |
| `idle-light-0.png` | hero idle under neon light 0 only | `nr_solo_0`, `input-idle.json`, tick 60 | identical pixels, state equal, 43 fields |
| `idle-light-1.png` | hero idle under neon light 1 only | `nr_solo_1`, `input-idle.json`, tick 60 | identical pixels, state equal, 43 fields |
| `idle-light-2.png` | hero idle under neon light 2 only | `nr_solo_2`, `input-idle.json`, tick 60 | identical pixels, state equal, 43 fields |
| `idle-all-lights-f60.png` | heroes idle under the three neons, one walking on its own frame | `nr_stage`, `input-idle.json`, tick 60 | identical pixels, state equal, 43 fields |
| `idle-all-lights-f120.png` | the same, the lights moved | `nr_stage`, `input-idle.json`, tick 120 | identical pixels, state equal, 43 fields |
| `mid-walk-stage.png` | the walking hero mid-stride | `nr_stage`, `input-idle.json`, tick 180 | identical pixels, state equal, 43 fields |
| `mid-walk-belt.png` | both players walking on the belt, mid-scroll | `nr_dummies`, `input-scroll.json`, tick 352 | identical pixels, state equal, 43 fields |
| `scroll-f061.png` | belt scroll: both players at one x, the camera on them | `nr_dummies`, `input-scroll.json`, tick 61 | identical pixels, state equal, 43 fields |
| `scroll-f232.png` | belt scroll: the trailing player at the left edge, the leader at the soft wall | `nr_dummies`, `input-scroll.json`, tick 232 | identical pixels, state equal, 43 fields |
| `scroll-f352.png` | belt scroll: mid-scroll | `nr_dummies`, `input-scroll.json`, tick 352 | identical pixels, state equal, 43 fields |
| `scroll-f426.png` | belt scroll: the pillar and the signs in view | `nr_dummies`, `input-scroll.json`, tick 426 | identical pixels, state equal, 43 fields |
| `scroll-f640.png` | belt scroll: the end of the street | `nr_dummies`, `input-scroll.json`, tick 640 | identical pixels, state equal, 43 fields |
| `pillar.png` | one player behind the pillar, a stand-in in front of it | `nr_dummies`, `input-pillar.json`, tick 243 | identical pixels, state equal, 43 fields |
| `pillar-bare.png` | the same street and lights, no actors (the control for the occlusion) | `nr_arena_bare`, `input-pillar.json`, tick 243 | identical pixels, state equal, 43 fields |
| `grunt-airborne.png` | wave 2: a grunt in the air | `nr_waves`, `input-waves.json`, tick 450 | identical pixels, state equal, 43 fields |
| `heavy-windup.png` | wave 3: the heavy winding up | `nr_waves`, `input-waves.json`, tick 990 | identical pixels, state equal, 43 fields |
| `wave4-crowd.png` | wave 4: the crowd, grunts and the heavy with both players | `nr_waves`, `input-waves.json`, tick 1600 | identical pixels, state equal, 43 fields |
| `heavy-staggered.png` | wave 4: the heavy staggered | `nr_waves`, `input-waves.json`, tick 2050 | identical pixels, state equal, 43 fields |
| `combat-hit2.png` | the combo: hit 2 landing | `nr_dummies`, `input-combat.json`, tick 49 | identical pixels, state equal, 43 fields |
| `combat-radius-special.png` | the radius special | `nr_dummies`, `input-combat.json`, tick 362 | identical pixels, state equal, 43 fields |
| `combat-dash-special.png` | the dash special | `nr_dummies`, `input-combat.json`, tick 429 | identical pixels, state equal, 43 fields |
| `title.png` | the title screen | `nr`, `input-2p-full.json`, tick 30 | identical pixels, state equal, 43 fields |
| `hud.png` | the fight with the HUD | `nr`, `input-2p-full.json`, tick 1000 | identical pixels, state equal, 43 fields |
| `upgrade.png` | the upgrade choice screen | `nr`, `input-2p-full.json`, tick 765 | identical pixels, state equal, 43 fields |
| `clear.png` | the clear screen | `nr`, `input-2p-full.json`, tick 2164 | identical pixels, state equal, 43 fields |

Not in the set: a hero mid-combo beside a grunt on the street (the combat captures use the test dummies, the wave captures
show the enemies fighting the bot's buttons), and the two hand-keyed clips (`jumpkick`, `grab`) that are gaps in the atlas.
