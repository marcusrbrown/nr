---
date: 2026-10-24
topic: combat-slice
---

# Combat slice: prove the look in one arena

Combat rules, enemy roles, upgrade and co-op rules here are starting positions that later slices may reverse. Camera, pixel density and the lit-sprite approach are locked for this slice once the look is approved, because every asset inherits them.

## Summary

One arena, one hero, two enemies, one special, one upgrade, one or two local players. The slice exists to prove Neon Rebellion's visual identity: hi-bit pre-rendered sprite actors lit by the arena's neon through normal maps, standing in a real three.c street block with visible depth. Combat is complete enough to be a brawler and no more.

---

## Problem Frame

The shipping-path spike proved that one C source tree builds to native and cart, runs under romdev's deterministic stepping, and renders y-ordered flat sprite planes in a three.c scene at 40 actors well inside the frame budget; that scene is far lighter than this slice and its margin does not transfer. It proved nothing about whether the game looks like anything. The seed material is a handful of DALL·E mood images and a chibi portrait; there is no art bible, no decided pixel density, no camera, no answer to whether sprites can be lit by the scene they stand in. Every later asset — hundreds of animation frames across heroes, enemies and bosses — inherits whatever is decided first, and reversing camera, scale or lighting after production starts means redrawing everything.

The art pipeline is the project's largest cost and its least proven part. Panthea's Blender→sprite route produced one locomotion set for one character; it has not produced a punch, a throw, a knockdown or a normal map.

---

## Actors

- A1. Player 1: controls the hero with keyboard or pad; always present.
- A2. Player 2: optional second instance of the same hero on a second pad; may join at the title or drop in mid-fight.
- A3. Grunt: numerous, fragile, rushes its assigned player.
- A4. Heavy: rare, armoured, slow, cannot be thrown.

---

## Key Flows

- F1. Clear the arena
  - **Trigger:** Start from the title (one or two players).
  - **Actors:** A1, A2, A3, A4
  - **Steps:** Camera clamps to keep all players in frame. Four waves arrive from the right; the belt scrolls as the players advance. Wave 2 adds a heavy. After wave 2 the upgrade choice appears; play resumes with the chosen special variant. Wave 4 ends the arena.
  - **Outcome:** Arena-clear screen, or game over when the shared lives pool is spent.
  - **Covered by:** R1–R6, R8–R13, R16–R18, R21–R23

- F2. Choose the upgrade
  - **Trigger:** Mid-arena wave cleared.
  - **Actors:** A1, A2
  - **Steps:** Play pauses; two special variants are shown; the first pick wins (lower port on the same frame); a player who joins during the pause gets whatever was chosen; play resumes with the chosen variant for both players.
  - **Outcome:** The hero's special is visibly different for the rest of the arena.
  - **Covered by:** R14, R15

---

## Requirements

**Visual identity**
- R1. Virtual resolution is 640×360, integer-scaled 3× to 1080p; the hero stands about 128 px tall at rest.
- R2. The camera is a fixed-angle perspective view along a belt-scroll axis; the belt scrolls horizontally with the players.
- R3. Actors are pre-rendered sprite frames with a matching normal map, authored from 3D models, placed as planes in the three.c scene.
- R4. The arena's coloured point lights visibly change actor shading as actors or lights move.
- R5. The arena is one street block about three screens wide with 3D storefronts and pillars that show parallax as the camera scrolls, and three to four animated neon lights.
- R6. Actor and environment occlusion follows ground position; a jumping actor keeps its ground ordering.
- R7. The look is approved from a fixed reference capture set, not from source art: hero idle under each of the arena's lights in turn, hero mid-combo beside a grunt, both players and a heavy in one frame, and one full belt scroll. Each capture has a yes/no checklist (lit side follows the light, silhouette reads at 3×, occlusion correct, no alpha fringing); the owner judges, and any unchecked item is a fail.

**Hero**
- R8. The hero has twelve clips: idle, walk, three combo hits, jump, jump-kick, grab, throw, hurt, knockdown, and one clip per special variant.
- R9. Grab succeeds on grunts and fails on heavies.
- R10. The special has two variants: an area knockback and a fast dash-strike; the player starts with the knockback.

**Enemies**
- R11. Grunts rush their assigned player and die in two hits.
- R12. Heavies walk slowly, take many hits, cannot be thrown, and are staggered only by the special.
- R13. Each enemy is assigned a player on spawn, alternating between present players; it retargets to the other player only if its target dies or leaves.
- R21. Grunt clips: walk, attack, hurt, death. Heavy clips: walk, attack, hurt, stagger, death.
- R22. Waves: 4 / 6 / 6 + 1 heavy / 8 + 1 heavy grunts. The shared lives pool starts at 3 per player present at the title; a dead player respawns at the camera edge while lives remain.

**Upgrade**
- R14. When the mid-arena wave is cleared, play pauses and both special variants are offered; either player's pick applies to both.
- R15. The chosen variant stays for the rest of the arena.

**Co-op**
- R16. A second player joins from the title or by pressing start mid-fight.
- R17. Players cannot damage each other.
- R18. Lives are one shared pool; the camera clamps so both players stay in frame, and a player cannot move more than one screen width ahead of the other (soft wall at the camera edge).

**Pipeline**
- R19. A scripted route turns a 3D character model and animation set into sprite frames plus normal maps plus an atlas manifest; on a clean checkout with the pinned Blender and script versions it reproduces the same atlas payload hashes.
- R20. The three characters' clip sets (R8, R21) are produced by that route, not hand-drawn.
- R23. The three characters are owner-authored profiles over pinned CC0 kits (Quaternius Universal Base Characters body, Universal Animation Library 1 and 2 clips), following the Panthea Studio route: a profile JSON selects body, hair, proportions, outfit/retexture, clip map and pose policy; clips the kits lack are hand-keyed in Blender. Each character records kit URLs, sha256s, licence, profile hash and hand-keyed clips in the asset provenance manifest. No image-to-mesh generation.

---

## Acceptance Examples

- AE1. **Covers R9, R12.** Given a grunt and a heavy in grab range, when the player grabs, the grunt is held and thrown; the heavy is not held and the hero recovers.
- AE2. **Covers R14, R15.** Given the mid-arena wave is cleared with two players, when player 2 picks dash-strike, both players' specials are dash-strike until the arena ends; the knockback does not return.
- AE3. **Covers R16.** Given a solo game in progress, when a second pad presses start, player 2 spawns at the camera edge and enemies begin splitting targets.
- AE4. **Covers R18.** Given two players, when one stands still at the left edge, the belt does not scroll past the point that would put them off-screen.
- AE5. **Covers R4.** Given a neon light sweeping across an idle hero, when captured frame by frame, the hero's lit side changes with the light's position.
- AE6. **Covers R6.** Given a grunt standing in front of a pillar and the hero behind it, when captured, the pillar occludes the hero and the grunt occludes the pillar.
- AE7. **Covers R11, R17.** Given a grunt between two players, when player 1's combo passes through player 2, player 2 takes no damage and the grunt dies on the second hit.
- AE8. **Covers R18.** Given two players, when player 1 runs ahead, player 1 stops at the camera edge one screen width ahead of player 2 until player 2 catches up.

---

## Success Criteria

Two gates; the look gate can pass before the brawler gate does.

- Look gate: the R7 capture set passes its checklist on native and cart, and the captures are kept under `docs/evidence/` as the look reference.
- Brawler gate: a scripted two-player run from title to arena-clear produces identical whitelisted simulation state natively and as a cart, and the three characters' clip sets came from the R19 route.
- Planning invents no product behaviour: movement, moveset, enemy roles and targeting, waves, lives, upgrade, co-op rules and look targets are stated here; only camera numbers, frame counts and the render recipe are left to planning.

---

## Scope Boundaries

- No destructible or interactive environment objects.
- No ranged enemies, bosses, or a second enemy roster.
- No stat-based upgrades, inventory, currency or persistent progression.
- No friendly fire.
- No second arena, second hero, cutscenes, dialogue or hub.
- No online play, no console targets.
- Combat is tuned for correctness and readability, not for feel; hitstop, input buffering and cancel windows are later work.

---

## Key Decisions

- Visual identity is the pass/fail, combat is functional: the look decides every later asset; combat feel can be tuned on top of a proven pipeline but not the other way round.
- Hi-bit over 16-bit: richer lighting and detail; the per-frame cost is an unverified estimate of 2–4×, mostly render time because the pipeline is scripted. Planning measures one character's full set before the other two start.
- Normal-mapped sprites in the three.c scene: sprite actors that react to the arena's lights are the identity. The first planning milestone is a lit normal-mapped plane on both GL and WebGPU; if three.c cannot do it, the slice stops and the owner re-decides the representation. Unlit sprites do not pass the look gate.
- Pre-rendered sprites over low-poly 3D actors: real meshes would get lighting for free but give up the pixel-art identity and the Panthea pipeline; rejected for this slice.
- Minimal brawler moveset: twelve hero clips plus four grunt and five heavy clips is the smallest set that reads as a beat 'em up and still exercises the pipeline at realistic volume.
- Grunt + heavy, upgrade as a special variant: the heavy tests the grab rule and the special; a variant is a visible change with no stat UI.
- Co-op defaults to cooperative: no friendly fire, shared lives, camera clamp; the simplest rules to tune and to explain.
- The pipeline is a deliverable: three characters of hi-bit animation cannot be hand-made within the slice.

---

## Dependencies / Assumptions

- three.c Standard material supports map + normal map + alpha test on a plane lit by point lights (unverified; the first planning milestone).
- Panthea's render scripts (GPL-3) are invoked as separate tooling; no Panthea code is copied into this repo. Blender and the Panthea commit are pinned in `scripts/deps.lock`.
- The spike's build, gate and deterministic romdev stepping carry over; the romdev host needs the native-gles repair on macOS and its playtest window is broken on 0.150.2, so live review is via `host{op:play}` and the livestream.
- The spike's perf budget (native p99 ≤ 16.6 ms) and image-tolerance method carry over; the tolerance is recalibrated on the lit scene.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R3, R4][Needs research] Does three.c render a normal-mapped alpha-tested plane under point lights on both GL and WebGPU paths, and what program states does that add?
- [Affects R19][Needs research] Which Panthea render-pipeline pieces transfer as invoked tooling, and what is the smallest script that adds a normal-map pass?
- [Affects R1, R2][Technical] Exact camera angle, field of view and sprite plane tilt that keeps 128 px sprites undistorted across the belt; source render resolution and downsample rule.
- [Affects R8, R21][Technical] Frame counts per clip within a cart atlas budget planning sets from the spike's memory numbers.
- [Affects R4][Technical] Frame budget re-measured with lit, normal-mapped actors at the wave-4 on-screen count.

---

## Sources / Research

- `docs/plans/2026-10-24-001-feat-shipping-path-spike-plan.md` and `docs/evidence/shipping-path-spike/README.md`: what the engine path already proves.
- `docs/solutions/`: toolchain and runner learnings from the spike.
- Character 3D models: owner-authored per R23.
- Panthea `tools/render/` and ADR-0012 (pre-rendered retro art direction) as the pipeline reference.
- Owner seed briefs in `.context/seed/` (untracked).
