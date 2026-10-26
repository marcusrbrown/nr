# Look gate capture set

The capture set of requirement R7, as one set: 28 captures at 1920x1080 on the native binary on WebGPU (Dawn on Metal, SDL's
offscreen driver, Apple M1 Pro). For each, the same capture on the cart (`build/cart-wgpu` in headless Chromium on WebGPU) gave
identical pixels, an equal whitelisted simulation state (43 fields) and, where the app has it, equal shockwave fields (`nr.fx_*`, 4) (`set.json`; `<name>.json` is the native run's reduced debug state).
`CHECKLIST.md` is the owner's checklist and is not filled in.

Regenerate: `CW_TEST_GPU=desktop node games/nr/tests/look-set.mjs`.

| File | Shows | App, input, tick | Cart vs native |
| --- | --- | --- | --- |
| `idle-light-0.png` | hero idle under neon light 0 only | `nr_solo_0`, `input-idle.json`, tick 60 | identical pixels, state equal, 43 fields, fx equal |
| `idle-light-1.png` | hero idle under neon light 1 only | `nr_solo_1`, `input-idle.json`, tick 60 | identical pixels, state equal, 43 fields, fx equal |
| `idle-light-2.png` | hero idle under neon light 2 only | `nr_solo_2`, `input-idle.json`, tick 60 | identical pixels, state equal, 43 fields, fx equal |
| `idle-all-lights-f60.png` | heroes idle under the three neons, one walking on its own frame | `nr_stage`, `input-idle.json`, tick 60 | identical pixels, state equal, 43 fields, fx equal |
| `idle-all-lights-f120.png` | the same, the lights moved | `nr_stage`, `input-idle.json`, tick 120 | identical pixels, state equal, 43 fields, fx equal |
| `mid-walk-stage.png` | the walking hero mid-stride | `nr_stage`, `input-idle.json`, tick 180 | identical pixels, state equal, 43 fields, fx equal |
| `mid-walk-belt.png` | both players walking on the belt, mid-scroll | `nr_dummies`, `input-scroll.json`, tick 352 | identical pixels, state equal, 43 fields, fx equal |
| `scroll-f061.png` | belt scroll: both players at one x, the camera on them | `nr_dummies`, `input-scroll.json`, tick 61 | identical pixels, state equal, 43 fields, fx equal |
| `scroll-f232.png` | belt scroll: the trailing player at the left edge, the leader at the soft wall | `nr_dummies`, `input-scroll.json`, tick 232 | identical pixels, state equal, 43 fields, fx equal |
| `scroll-f352.png` | belt scroll: mid-scroll | `nr_dummies`, `input-scroll.json`, tick 352 | identical pixels, state equal, 43 fields, fx equal |
| `scroll-f426.png` | belt scroll: the pillar and the signs in view | `nr_dummies`, `input-scroll.json`, tick 426 | identical pixels, state equal, 43 fields, fx equal |
| `scroll-f640.png` | belt scroll: the end of the street | `nr_dummies`, `input-scroll.json`, tick 640 | identical pixels, state equal, 43 fields, fx equal |
| `pillar.png` | one player behind the pillar, a stand-in in front of it | `nr_dummies`, `input-pillar.json`, tick 243 | identical pixels, state equal, 43 fields, fx equal |
| `pillar-bare.png` | the same street and lights, no actors (the control for the occlusion) | `nr_arena_bare`, `input-pillar.json`, tick 243 | identical pixels, state equal, 43 fields, fx equal |
| `grunt-airborne.png` | wave 2: a grunt in the air (the thrown grunt's tick 8) | `nr_waves`, `input-waves.json`, tick 424 | identical pixels, state equal, 43 fields, fx equal |
| `heavy-windup.png` | wave 3: the heavy winding up (tick 8 of its attack) | `nr_waves`, `input-waves.json`, tick 935 | identical pixels, state equal, 43 fields, fx equal |
| `wave4-crowd.png` | wave 4: the crowd, grunts and the heavy with both players | `nr_waves`, `input-waves.json`, tick 1560 | identical pixels, state equal, 43 fields, fx equal |
| `heavy-staggered.png` | wave 4: the heavy staggered (tick 5 of the stagger) | `nr_waves`, `input-waves.json`, tick 1910 | identical pixels, state equal, 43 fields, fx equal |
| `combat-hit2.png` | the combo: hit 2 on a real grunt backed against the pillar, tick 8 of the state (clip frame 2, the extension, 0.86 units from the pivot) | `nr_look`, `input-look.json`, tick 264 | identical pixels, state equal, 43 fields, fx equal |
| `combat-hit3.png` | the combo: hit 3 on the same grunt, tick 8 of the state (clip frame 2, 1.08 units) | `nr_look`, `input-look.json`, tick 280 | identical pixels, state equal, 43 fields, fx equal |
| `combat-radius-special.png` | the radius special with real grunts and the heavy on both sides of the hero, all hit on one tick and pushed outward, tick 18 of the state (clip frame 4, the landing crouch with a hand to the ground); the magenta ring at the full hit radius (2.4 units), 0.56 into its fade | `nr_look`, `input-look.json`, tick 128 | identical pixels, state equal, 43 fields, fx equal |
| `combat-radius-special-mid.png` | the same, one tick after the hit: tick 13 of the state (frame 3), the ring at 0.75 of the hit radius (1.8 units), the flash at 8.1 of 10, every enemy one tick into its reaction | `nr_look`, `input-look.json`, tick 123 | identical pixels, state equal, 43 fields, fx equal |
| `combat-radius-special-p2.png` | player 2 (cyan) uses the radius special, tick 13 of the state: the cyan ring at 0.75 of the hit radius, six enemies reacting on both sides | `nr_look`, `input-fx-p2.json`, tick 103 | identical pixels, state equal, 43 fields, fx equal |
| `combat-dash-special.png` | the dash special into real grunts, tick 9 of the state (clip frame 2, its widest reach, 1.19 units) | `nr_look`, `input-look.json`, tick 49 | identical pixels, state equal, 43 fields, fx equal |
| `title.png` | the title screen | `nr`, `input-2p-full.json`, tick 30 | identical pixels, state equal, 43 fields, fx equal |
| `hud.png` | the fight with the HUD | `nr`, `input-2p-full.json`, tick 1000 | identical pixels, state equal, 43 fields, fx equal |
| `upgrade.png` | the upgrade choice screen with both options, the pause after wave 2, no pick made | `nr`, `input-2p-full.json`, tick 700 | identical pixels, state equal, 43 fields, fx equal |
| `clear.png` | the clear screen | `nr`, `input-2p-full.json`, tick 2164 | identical pixels, state equal, 43 fields, fx equal |

Combat captures (`nr_look`, `games/nr/main.c` `NR_LOOK`): the street block with real grunts and a heavy that stand still
(`sim.passive`: they take hits and react, and never swing or move on their own), three stations along the street, played by
`input-look.json` (written by `gen-input-look.mjs`). The tick of each capture is chosen inside the state's active window as the
tick whose clip frame shows the reach: a combo state's hit lands on tick 4, when the clip still draws the wind-up; tick 8 is
frame 2, the extension, inside the active ticks 4 to 12. The radius special hits on tick 12 of its state, every enemy at once, and tick 18 (frame 4) has all six enemies six ticks into their reaction, pushed away on
both sides of the hero, inside the shockwave ring (tick 13, one tick after the hit, is the mid-expansion capture; `look-set.mjs` asserts the published ring radius, colour scale
and flash against what the C computes from the state tick, and that the ring's samples on the picture carry the player's colour); the dash special's frame 2 is its widest. `look-set.mjs` asserts the player's state, state tick and
drawn frame and each enemy's reaction from the native run before it keeps a picture; the radius special also requires at least two enemies on each side of the hero reacting on the same state tick. Player 1 wears magenta, player 2 cyan.

Screen captures (`title`, `hud`, `upgrade`, `clear`) assert the phase and the facts that tell the screen from its neighbours before a picture is
kept: the upgrade choice is the pause from tick 667 to the pick at 718; tick 700 is past its 30-tick grace period, `nr.phase` 2, `nr.pick_player` -1,
`nr.special_variant` 0. `look-set.mjs --control` takes the screens at wrong ticks (the upgrade at 765, after the pick) and requires each to be rejected.

Not in the set: the two hand-keyed clips (`jumpkick`, `grab`) that are gaps in the atlas.
