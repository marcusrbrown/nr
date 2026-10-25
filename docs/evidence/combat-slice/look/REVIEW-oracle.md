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
