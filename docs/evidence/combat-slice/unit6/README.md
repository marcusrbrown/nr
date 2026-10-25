# Unit 6 evidence: enemies, waves, lives, targeting

Produced by `games/nr/tests/` against `games/nr`. The street the combat checks use is now the `nr_dummies` app (the street
block with the Unit 5 test dummies and no waves); `nr` is the game (two heroes, the waves). `nr_bot` plays both players with
the bot in `main.c` from the first tick, `nr_bot1` plays player 0 only and fights only the enemies that chase it.

Hosts. The pictures come from the native binary on WebGPU (Dawn on Metal, offscreen) and the same set from the dual cart
(`build/cart-wgpu`) in headless Chromium on WebGPU: 59 of 59 captures with identical pixels and equal state
(`captures/captures.json`). Every script below also runs on four hosts (native WebGPU, cart WebGPU, native GL, cart GL):
`cw.three.missing` is 0 on all of them and the whole `nr.*` state equals the native WebGPU run's (`waves-hosts.json`).

## Atlases

| Character | Frames | Clips | Cell | Page | Sheets (colour + normal) | Decoded pair |
| --- | ---: | --- | --- | --- | --- | ---: |
| hero (unchanged) | 96 | 14 | 160x160 | 1920x1280 | 106 KB + 951 KB | 18.75 MiB |
| grunt | 27 | idle 4, walk 5, attack 5, hurt 4, knockdown 5, getup 4 | 160x160 | 1920x480 | 26 KB + 227 KB | 7.03 MiB |
| heavy | 27 | idle 4, walk 6, attack 8, hurt 4, stagger 5 | 224x224 | 2016x672 | 37 KB + 392 KB | 10.34 MiB |

Budget (ADR-0002, 64 MiB): hero + grunt + heavy are **36.12 MiB** decoded (38.46 MiB with the hero's planned 106 frames);
the load peak (one more sheet decoding) is 49.01 MiB. `enemies-check.txt` (17 of 17 checks) states the same, with the
manifests' provenance hashes, the clips against the audited actions, the pivots inside every rect and the state table against
the clips. The heavy's cell is 224 square because its hook reaches 190 texels from the cell's left edge. Contact sheets:
`contact-grunt.png`, `contact-heavy.png`.

## Scenarios (Unit 6 plan)

`sim-check.mjs` runs all 27 scenarios (the 17 of Unit 5 on `nr_dummies`, 10 new ones on `nr`, `nr_bot1`, `nr_bot`); the
output is `sim-check.txt`. Each new scenario's artifact is an event log with every state entry, hit, spawn, retarget and wave
event of its run.

| Scenario | Result | Artifact |
| --- | --- | --- |
| Waves 4 / 6 / 6 + heavy / 8 + heavy, spawned at the camera edges inside the clamp | pass: waves begin at 60, 369, 818, 1394 and end at 219, 668, 1244, 2374 (each on its last kill); the heavy spawns after the grunts; 6 spawns checked at the frame's edge inside the lanes, 3 left and 3 right; cleared at 2374 | `events-waves.txt` |
| Two players: 6 grunts assigned 3 / 3; a kill reassigns nothing | pass: wave 2 targets 0,1,0,1,0,1; the death of a player-2 enemy at 494 with 4 others standing logs no retarget and keeps their targets | `events-waves.txt` |
| Player 2 dies: its grunts retarget to player 1 | pass: on `nr_bot1` with player 2 idle, it falls at 1131; the 2 enemies chasing it retarget at 1144 and 1151; 70 ticks on none chases it | `events-retarget.txt` |
| Grab on a heavy fails and the hero recovers; the special staggers it | pass: 4 grabs on heavies fail (987, 996, 1623, 1679): no grab or grabbed state, hp unchanged, the hero idle 20 ticks later (or struck by the heavy first, 2 of the 4); the one stagger (2050) comes from a special_knockback and lasts 60 ticks, no other hit staggers | `events-waves.txt` |
| Wave 3 waits for wave 2's last kill | pass: the last kill is 668; wave 2 ends and the upgrade flag goes 0 -> 1 on that tick; the street is clear at 743 (phase waiting); wave 3 begins at 818 (150 ticks after) | `events-waves.txt` |
| Solo: every enemy targets player 1, the pool is 3 | pass: tick 1 has both heroes (6 lives), tick 30 decides the players (1, 3 lives); the 4 spawns of wave 1 all chase player 1; the absent hero has no events | `events-solo.txt` |
| Respawn inside the clamp | pass: 6 respawns across the solo and `nr_bot1` runs, each 90 ticks after its life was lost with lives left, idle at hp 12, 120 ticks invulnerable, at the frame's left edge inside the lanes | `events-solo.txt`, `events-retarget.txt` |
| Game over stops the sim and refuses start | pass: lives lost at 1064, 2208, 3389 (pool 2, 1, 0), game over at 3389; actors, camera, wave, lives and rng are identical at 3391, 3789 and 6000 while the tick counter runs; the 8 start presses after it are each refused and counted, the 10 before it are not | `events-solo.txt` |
| Pad 2 disconnects mid-combo | pass: unplugged at 118 in hit2 (entered 115): the swing finishes, the hero is idle at 137 (no hit3), stays idle, invulnerable and untargeted until the pad is back at 560 (no hits or skips on it, no enemy chases it, the grunt that did retargets at 118, the next spawn chases player 1), lives stay 6; a press at 580 starts hit1 | `events-disconnect.txt` |
| Four-wave scripted run: identical checksum twice | pass: `input-waves.json` (the bot's buttons) twice: 44 fields byte-identical, checksum 2063173580 both times, screenshots identical; the bot's own run on `nr_bot` ends on the same checksum | `waves-determinism.json`, `waves-final-state.json` |
| Unit 5 scenarios on `nr_dummies` | pass (17 of 17: combo, late press, knockback, grab and throw, grab fails, jump kick, radius special, pillar, dash special, friendly fire, hero hurt, movement, state table, determinism, input shift, whitelist, layout) | `sim-check.txt`, `events.txt` |
| Whitelist | pass: 36 fields with the expected sizes for 11 actors (two heroes and 9 enemy slots); every actor's pos, jump, state, hp, plus kind, target, away and present, rng, wave, lives, camera, ticks, input count, checksum | `sim-check.txt`, `final-state.json` |
| `cw.three.missing == 0`; program tables | pass: 0 on native and cart, WebGPU and GL, for the 59 captures, the 18 GL state runs and the 5 scripts on 4 hosts; `programs-survey.mjs` finds no new program state with the waves, solo, disconnect and combat scripts (`games/nr/programs/` unchanged); the four row-removal controls give `cw.three.missing == 1` naming that row | `programs-survey.txt`, `programs-controls.txt`, `waves-hosts.json`, `captures/captures.json` |
| Earlier checks | pass: stage, lit-side (both facings), scroll and ordering checks on this build | `earlier-checks.txt` |
| romdev: WebGPU cart, script against native, self-play against native, live | pass: `gpu "webgpu"`, `conforms` true; the 2700 ticks of `input-waves.json` (frame 1 consumed by loadMedia) end on checksum 2063173580 equal to native's, 42 `nr.*` fields equal; the cart's own bot (`nr.demo` 2) over 2600 ticks equals native `nr_bot` at tick 2600 (checksum 1710320280); then the self-play runs on the livestream in session `nr-unit6` | `romdev/waves-f2700.json`, `romdev/demo-f2600.json`, `romdev/waves-f*.png` |

## Decisions the plan did not state

- Players present. The plan says "present at the title"; there is no title yet and a host may report the second pad a frame
  late (romdev's loadMedia consumes frame 1 with no input, the native platform reports pads as events). Both heroes stand on
  the street until tick 30 (`NR_PRESENCE_TICKS`, before wave 1 begins at 60) and the players are the pads connected on that tick.
  Disconnects before it are not tracked; from it on they are.
- Heavy: 16 hp, 62-tick hook (8 frames at 130 ms) with a 24-tick windup, 3 damage and a knockdown; walks 0.025 units a tick (a
  hero walks 0.06); a hit while it swings does not flinch it and a flinch is followed by 120 ticks that a hit does not repeat;
  it is pushed half what a grunt is by a special; a special staggers it for 60 ticks. Grunt: 2 hp, 21-tick jab (8 startup, 4
  active), 1 damage, a swing every 80 ticks at most, walks 0.045 units a tick. The grunts' lane offsets spread them round their
  target.
- The test dummy and the Unit 5 scripts stay on `nr_dummies`; `nr_arena_bare` keeps the dummies too (the ordering control).
- The bot (`main.c`) exists to play the four-wave run and the livestream. It reads only the simulation and its input goes through
  the pad path: the buttons it chooses are `input-waves.json`, and the `nr` build under that script equals the bot's run.
  It is neutral on the first tick.

## What to tune

- `tools/render/profiles/grunt.json`: `body` (`widthScale` 0.86, `standingHeightPx` 120), the hoodie, jeans and lime accent
  (`palette.trim`, `palette.wrap`), `models.hair` (Hair_Long), the sleeve stripes and jean attachments. The kit's base-character
  pack pinned here holds only the Superhero body, so the grunt is that body made leaner, not a Regular base.
- `tools/render/profiles/heavy.json`: `body` (`widthScale` 1.55, `depthScale` 1.3, `headScale` 0.86, `handScale` 1.5), the
  dark plate palette and the `hot` / `hotDim` / `visor` accent, the armour attachments (chest plate, pauldrons, bracers, knee
  and shin plates, helm, back pack). Re-pin the recipe with `tools/render/pin-profile.mjs` and re-render after a change.
- `ENEMY[]` and the attack rows in `games/nr/sim.c` (speeds, reach, cooldown, damage, hp), `NR_WAVE_*` in `waves.h`.

## Not done here

- No upgrade UI: wave 2's end sets `nr.upgrade_ready` and the next wave still begins 150 ticks later.
- No title, no join: a player whose pad is not connected at tick 30 is out of the game until Unit 7.
- No death clips beyond the knockdown (grunt) and the stagger's last frame (heavy), no grab or jump kick clips (hand-keyed).
- Grunts lying down in the wave 4 picture look translucent where bodies overlap: the knockdown frames' alpha edges against
  the lit atlas; not investigated.

Regenerate with `CW_TEST_GPU=desktop node games/nr/tests/sim-check.mjs --publish docs/evidence/combat-slice/unit6`,
`look-captures.mjs --publish .../captures`, `waves-hosts.mjs --publish ...`, `enemies-check.mjs --publish ...`,
`programs-survey.mjs` and `romdev-waves.mjs`.
