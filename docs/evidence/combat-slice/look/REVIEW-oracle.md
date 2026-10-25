# Independent look-gate review (Oracle, 2026-10-25, HEAD b02d851)

Verdict: NOT MET. R7 requires a hero mid-combo beside a grunt; `combat-hit2.png` shows hero-shaped test dummies (confirmed in `README.md`). Two checklist items fail: "combo and both specials read" and "full scroll holds together".

Checklist: 20 yes, 3 no (combo/specials read; full scroll holds together; look gate passes). All lighting, occlusion, parallax, enemy-read, HUD/screen and cart-parity items pass on the cited captures.

Findings, ranked, each with its tunable:

1. Combat silhouettes do not explain the action (`combat-hit2.png`, `combat-radius-special.png`). Tunable: hero clip segments/frame selection; capture real contact and maximum special extension beside a real grunt.
2. Heavy detail collapses in darker lighting (`heavy-windup.png`, `heavy-staggered.png`). Tunable: `heavy.json` palette `plate`, `helm`, `boots`, `plateHi` values, before any ambient change.
3. Co-op heroes are not mappable to their HUD colours (`hud.png`, `wave4-crowd.png`). Tunable: per-player accent in the hero profile tied to the magenta/cyan HUD colours.
4. Camera margin cuts walking silhouettes at both edges (`scroll-f426.png`, `scroll-f352.png`). Tunable: clamp silhouette allowance (currently 0.45-unit half-width in ADR-0002) sized to maximum animation reach; FOV/pitch unchanged.
5. Static street depth relies on overlap and scrolling; large uniform storefront panels flatten it (`pillar-bare.png`, `scroll-f352.png`). Tunable: arena material values and side-face returns.
6. Title prompt "PRESS START AGAIN TO FIGHT" has weaker contrast than decoration (`title.png`). Tunable: text colour or backing opacity.

Not judged from stills: animation timing, camera smoothness, flicker comfort, ordering during jumps, audio. Captures were viewed at 1024×576 previews of the 1920×1080 originals.

## Round 2 review

Verdict: **NOT MET**. Blocking: `upgrade.png` was captured after the choice (`nr.pick_player` 1, `nr.special_variant` 1), so it shows gameplay. Partly resolved: `combat-radius-special.png` reads as directed rather than area. Resolved: heavy contrast (2), player identity (3), camera allowance (4), static arena depth (5), title prompt contrast (6). Checklist: 24 yes, 2 no (combo/specials read; upgrade screen), plus the look-gate line.

Fixes (Round 3, HEAD f9a0bed onward; evidence in `docs/evidence/combat-slice/README.md`, "Round 2"):

1. `upgrade.png` (blocking): the capture is tick 700 of `input-2p-full.json`, inside the upgrade pause (`nr.phase` 2, entered at tick 667, ended by the pick at 718), past the 30-tick grace period and before any pick (`nr.pick_player` -1, `nr.special_variant` 0, wave 2). Both option cards are on screen. `look-set.mjs` asserts the phase and facts of every screen capture before keeping it (title: phase 0, one player in; hud: fight, wave 3, two players; upgrade: phase 2, no pick; clear: phase 3, cleared), and `look-set.mjs --control` takes the screens at wrong ticks (the upgrade at 765, the title at 1000, the clear at 1000, the hud at 700) and requires each to be rejected.
2. `combat-radius-special.png` (partly): the clip is now the landing crouch of `NinjaJump_Land` (hand to the ground) instead of the one-arm point of the Spell_Simple actions, and the `nr_look` scene has grunts and the heavy on both sides of the hero. The capture is tick 18 of the special, six ticks after the hit that lands on all six enemies at once; the assertion requires at least two enemies reacting on each side of the hero on one state tick. hero.json was changed, re-pinned, and the hero and hero-p2 atlases re-rendered and installed.
