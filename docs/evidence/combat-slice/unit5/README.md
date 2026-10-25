# Unit 5 evidence: combat simulation, test dummy and the owner's items

Produced by `games/nr/tests/` against `games/nr` (the `nr` app: the street block, two heroes, seven test dummies).

Hosts. The pictures come from the native binary on WebGPU (Dawn on Metal, offscreen) and the same set from the dual cart
(`build/cart-wgpu`) in headless Chromium on WebGPU; `captures/captures.json` carries, per capture, the cart's size against the
native's, whether the pixels are identical and whether the simulation state is equal (54 of 54 captures: identical pixels,
equal state). The GL runs (native on GL, `build/cart` in headless Chromium on GL) write no pictures; they run each script
and record `cw.three.missing` (17 runs, all 0, checksums equal). The combat checks run on the native binary because they
read state, not pixels; the cart runs the same script in the romdev session below and its whole `nr.*` state equals the
native one's.

The simulation is `games/nr/sim.c` / `sim.h`; the combat script is `games/nr/tests/input-combat.json`, generated with
`games/nr/demo_combat.inc` (the same script as the table the cart plays when a host sets `nr.demo`) by
`games/nr/tests/gen-input-combat.mjs` (`--check` compares both files with the generator). `sim-check.mjs` states each
expectation from the script's own presses and from the state table it reads out of `sim.c`.

## Scenarios

| Scenario (plan, Unit 5) | Result | Artifact |
| --- | --- | --- |
| Combo: hit1 -> hit2 -> hit3 on presses inside the recovery window; hit3 knocks down | pass: presses at 30, 45, 60 (15 ticks in; window 13..21); hits at 34, 49, 64 for 1, 1, 2 hp; dummy ends knocked down at hp 8 | `sim-check.txt`, `events.txt`, `captures/combat-f49.png` |
| A late press restarts at hit1; a press in the active ticks does not chain | pass: press at 108 (swing tick 8, active 4..12) does not chain; the swing ends at 122; the press at 124 enters hit1 | `sim-check.txt` |
| Knockback decays | pass: the victim of hit1 moves 0.060, 0.050, 0.040, 0.030, 0.020, 0.010, 0.000 units over the ticks after the hit, 0.210 in all | `sim-check.txt` |
| Grab -> throw -> arc -> landing | pass: grab at 172 takes the dummy at 178, released at 188, 34 ticks of flight (peak 1.27 high, 3.40 units on), lands at 222 for 2 hp and a knockdown | `sim-check.txt`, `captures/combat-f183.png`, `captures/combat-f205.png` |
| Grab fails on the ungrabbable dummy | pass: found at 236, grab-fail logged, no grab or throw, the hero is idle at 250 (20 ticks), the dummy keeps hp 12 | `sim-check.txt` |
| Jump kick on the way down | pass: jump at 252, kick at 277 (vy -0.052, 1.02 high); one hit on the first active tick 279 for 2; ends at the landing, 289 | `sim-check.txt`, `captures/combat-f279.png` |
| Radius special | pass: at its first active tick (362) the 4 dummies within 2.4 units are each hit once for 1 and pushed 2.1 units further out (1.35 for the one the pillar stops); the 3 outside are untouched; the player in range is skipped as a teammate | `sim-check.txt`, `captures/combat-f362.png` |
| Dash special | pass: the hero moves 4.500 units (15 ticks at 0.3); each of the two dummies on the path is hit once (429, 435) in path order | `sim-check.txt`, `captures/combat-f429.png` |
| No friendly fire | pass: a swing at 604 over player 1 (0.28 units away, in reach) is logged as a teammate skip; player 1 keeps hp 9 and stays idle; the same swing hits the enemy | `sim-check.txt`, `events.txt` |
| Hero hurt: invulnerability, knockdown, getup | pass: hurt at 84 (hp 11, 60 ticks invulnerable); the swing at 114 is skipped; the knockdown swing at 174 hits for 2 (hp 9); down 43 ticks, getup 32, idle at 249 | `sim-check.txt` |
| Walk, run on a double tap, dash, plain jump, facing | pass: walk 0.06/tick, run 0.11/tick, dash 2.60 units in 25 ticks, plain jump 36 ticks (the jump clip's), facing follows input and the attacker | `sim-check.txt` |
| Pillar blocks every actor (owner item 3) | pass: a dummy pushed at the pillar by the radius special (the push alone would carry it to x 11.69) stops at x 10.934, the pillar's edge less the actor half width 0.45, with no input of its own | `sim-check.txt` |
| State table matches the clips | pass: every timed state's length is within a tick of its clip's frames x ms | `state-table.json` |
| Same script twice | pass: 34 whitelisted fields byte-identical (sha256 b1fa51fe8d4051f2), checksum 1601733016 both times, the screenshot byte-identical | `determinism.json` |
| One-tick input shift control | pass (diverges as required): the checksum differs from tick 2 on (2895164928 against 306849859) and at the end (1601733016 against 3538269910) | `shift-control.json` |
| Whitelist | pass: 26 fields with the expected sizes for 9 actors; wave 0, lives 3, 0 events dropped, `cw.three.missing` 0 | `sim-check.txt`, `final-state.json` |
| `cw.three.missing == 0`; program tables | pass: 0 on native and cart, WebGPU and GL, for every run above; `programs-survey.mjs`: no new program state with the combat script and the left-facing builds (`games/nr/programs/` unchanged); the four controls (each program row removed) give `cw.three.missing == 1` naming exactly that row, the baseline 0, on the combat script | `look-captures.txt`, `programs-survey.json`, `programs-controls.txt` |
| romdev: WebGPU cart, conformance, script, state against native, demo | pass: `gpu "webgpu"`, `conforms` true, 760 ticks of `input-combat.json` with the load frame counted, checksum 1601733016 equal to native's, the 33 `nr.*` fields equal; then the cart plays the same script itself (`nr.demo` 1) and ends in the same state | `romdev/combat-f760.json`, `romdev/demo-f760.json`, `romdev/combat-f*.png` |

## Owner items

| Item | Result | Artifact |
| --- | --- | --- |
| 1. Skyline | A far layer behind the two building rows: 19 dark silhouette towers (1.4 to 3.5 units wide, 0.65 to 1.34 high) at z -15.4, 47 lit windows across them and a few aerials, against a hazed dusk sky (magenta at the horizon through violet to blue, emissive bands on the sky plane). The six far storefront towers are 2.75 to 3.35 high and a mid row of lower buildings was added, so the skyline shows in the strip above the storefronts. It scrolls at 0.549 of the play lane's rate against 0.791 for the far storefronts (predicted 0.548 and 0.783). The far row has a 3.6-unit gap at x 16.4 to 20 so the skyline's reference window stays in view for the parallax measurement | `captures/scroll-f352.png`, `captures/scroll-f61.png`, `scroll-check.txt` (parallax line), `scroll-report.json` |
| 2. Facing | Actors facing left draw on a plane with the frame's u range reversed and the pivot offset mirrored (a negative x scale is not used: three.c does not turn the front face of a mirrored world matrix, so the plane would be culled). The lit-side check passes on a left-facing hero on the mirrored plane (builds `nr_lit_h_left`, `nr_lit_v_left` and their flat controls): the left and right class counts swap (1050/763) and the swing ratios equal the right-facing run's. The ordering check follows the mirrored plane | `lit-side-check-left.txt`, `lit-side-left-report.json`, `ordering-check.txt` |
| 3. Pillar blocking for all actors | `move_actor` in sim.c applies `arena_blocked` to every actor and every kind of movement (walk, knockback, jump and throw drift, dash, the dash special) | `sim-check.txt` (pillar line) |
| 4. One JSON reader | `games/nr/json.c` / `json.h`; `anim.c` and `arena.c` use it, 153 lines less in anim.c, the copy in arena.c gone. The atlas and arena checks give the same pictures as before | commit `1d57749` |
| 5. ADR-0002 lit-side ratios | refreshed from the Unit 3 atlas: 9.0x to 9.8x horizontal, 7.3x to 8.3x vertical (were 3.3x to 3.7x and 7.6x to 8.9x) | `lit-side-check.txt`, `docs/decisions/0002-render-pipeline-and-look.md` |
| Unit 2 checks still pass | `stage-check.mjs`, `lit-side-check.mjs` (right-facing), `scroll-check.mjs`, `ordering-check.mjs` all pass on this build; the reversed-depth control still fails as required | `stage-check.txt`, `lit-side-check.txt`, `scroll-check.txt`, `ordering-check.txt`, `ordering-control.txt` |

## State table (60 Hz ticks)

Each state's length is its clip's frames x ms, rounded; `startup` is the first hit-test tick, `active` the number of hit-test
ticks, the rest is recovery (`state-table.json`).

| State | Ticks | Startup | Active | Recovery | Notes |
| --- | --- | --- | --- | --- | --- |
| idle, walk, run | until input | | | | walk 0.06/tick, run 0.11/tick after a double tap within 14 ticks |
| hit1, hit2 | 22 | 4 | 9 | 9 | a press from tick 13 chains; damage 1; knockback 0.06 over 6 ticks |
| hit3 | 25 | 4 | 9 | 12 | damage 2; knocks down; knockback 0.18 over 12 ticks |
| jump | 36 (until landing) | | | | takeoff vy 0.13, gravity 0.0076; drift at the takeoff speed; attack from tick 4 kicks |
| jumpkick | until landing | 2 | until landing | | damage 2, knocks nothing down, 0.16 over 10 ticks; visual = the jump clip's last frame |
| grab | 20 | 6 | 4 | 10 | takes the first grabbable enemy in reach; an ungrabbable one is logged and the grab goes on; visual = the idle clip's first frame |
| throw | 29 | | | | releases at tick 10; arc vx 0.10, vy 0.11, gravity 0.0074; landing damage 2, knockdown |
| hurt | 19 | | | | heroes are invulnerable for 60 ticks from the hit |
| knockdown, getup | 43, 32 | | | | nothing hits an actor in either |
| dash | 25 | | | | 0.2/tick on ticks 3..15 |
| special_knockback | 38 | 12 | 4 | 22 | radius 2.4 from the hero; damage 1; push 0.28 over 14 ticks away from the hero |
| special_dash | 29 | 6 | 15 | 8 | 0.3/tick, 15 ticks, 4.5 units; the box reaches 0.3 behind to 1.0 ahead; damage 2 |

A melee swing here is the clip's length with the action2d active window (9 ticks), where action2d's 9 active and 18 cooldown
ticks would make 31; see the note below. Knockback, invulnerability (60) and the 9 active ticks are action2d's values.

## Debug whitelist

`nr.hero_pos` (x, ground-y, depth z per actor), `nr.actor_y` and `nr.actor_vy` (jump height and velocity), `nr.actor_state`,
`nr.actor_state_tick`, `nr.actor_hp`, `nr.actor_facing`, `nr.actor_team`, `nr.actor_invuln`, `nr.hero_clip`, `nr.hero_step`,
`nr.hero_frame`, `nr.rng` (the 4-word cursor), `nr.wave` (0), `nr.lives` (3), `nr.cam_x`, `nr.cam_left`, `nr.ticks`,
`nr.input_count`, `nr.checksum` (the whole published state), `nr.sim_checksum` (the simulation's own rolling checksum),
`nr.event_count`, `nr.events_dropped`, `nr.events` (the event log: tick, kind, actor, a, b), `nr.light_pos`,
`nr.light_intensity`, `nr.demo` (input: a host sets it to 1 to play the script). `nr.px` and `nr.demo` are not compared
between hosts; the rest are.

Committed: `captures/` (the combat pictures at ticks 49, 183, 205, 279, 362, 429 and 700 and the earlier set, each with its
reduced state), `events.txt` (all 106 events of the script), the reports above and `romdev/` (screenshots at ticks 183, 279, 362,
700 and 760, the debug state at 760 from the script and from the demo). Regenerate with
`CW_TEST_GPU=desktop node games/nr/tests/sim-check.mjs --publish docs/evidence/combat-slice/unit5`,
`look-captures.mjs --publish .../captures`, and `romdev-combat.mjs`.
