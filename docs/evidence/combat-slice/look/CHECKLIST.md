# Look gate checklist (owner review)

Requirement R7: the look is approved from this fixed capture set, not from source art. Each item is yes or no; any unchecked
item is a fail. The captures are `*.png` in this directory, 1920x1080, taken on the native binary on WebGPU; `set.json` records
for each that the cart on WebGPU (headless Chromium, `build/cart-wgpu`) produced the same pixels and the same simulation
state. Nothing below has been filled in: the checklist is the owner's.

What each file shows is in `README.md` (this directory). Mark an item when you have looked at the captures it names; write any
note under it (what to tune in `tools/render/profiles/`, `games/nr/assets/arena/` or the lights).

## Lit side follows the light

- [ ] Hero idle under neon light 0 (magenta): the lit side is the magenta side (`idle-light-0.png`)
- [ ] Hero idle under neon light 1 (cyan): the lit side is the cyan side (`idle-light-1.png`)
- [ ] Hero idle under neon light 2 (amber): the lit side is the amber side (`idle-light-2.png`)
- [ ] With all three neons the lit side moves as the lights move (`idle-all-lights-f60.png`, `idle-all-lights-f120.png`)
- [ ] The grunt and the heavy are lit by the same lights as the hero (`grunt-airborne.png`, `heavy-windup.png`, `wave4-crowd.png`, `heavy-staggered.png`)
- [ ] Facing left lights the left-facing figure's matching side (`wave4-crowd.png`, `scroll-f232.png`)

## Silhouette reads at 3x

- [ ] The hero reads mid-stride (`mid-walk-stage.png`, `mid-walk-belt.png`)
- [ ] The grunt reads against the street, in the air and on the ground (`grunt-airborne.png`, `wave4-crowd.png`)
- [ ] The heavy reads as the heavy, wound up and staggered (`heavy-windup.png`, `heavy-staggered.png`)
- [ ] Both players and a heavy in one frame are separable (`wave4-crowd.png`)
- [ ] The combo and the specials read: hit 2 landing, the radius special, the dash special (`combat-hit2.png`, `combat-radius-special.png`, `combat-dash-special.png`)

## Occlusion is correct

- [ ] The actor behind the pillar is hidden by it, the actor in front is not (`pillar.png`; `pillar-bare.png` is the same street without actors)
- [ ] Actors stand in front of the shop fronts and the street, never cut by them (`scroll-f352.png`, `wave4-crowd.png`)

## Belt scroll

- [ ] The full scroll holds together: both players at one x, trailing at the left edge, mid-scroll, the pillar and signs in view, the end of the street (`scroll-f061.png`, `scroll-f232.png`, `scroll-f352.png`, `scroll-f426.png`, `scroll-f640.png`)
- [ ] The layers move at believable parallax (near shop signs, far towers, skyline) across those five

## No alpha fringing

- [ ] No dark or bright fringe around any figure (all character captures)
- [ ] A knocked-down figure looks solid, not translucent (`wave4-crowd.png`; known: `docs/evidence/combat-slice/unit7/translucency/README.md` explains the rim-normal darkening that was accepted for this slice)

## Screens

- [ ] The title screen reads (`title.png`)
- [ ] The HUD in the fight reads (`hud.png`)
- [ ] The upgrade choice screen reads and both options are clear (`upgrade.png`)
- [ ] The clear screen reads (`clear.png`)

## Both hosts

- [ ] The cart captures show the same scene as native (`set.json`: every capture identical to native, state equal)

## Verdict

- [ ] The look gate passes (every item above checked)

Reviewer, date, notes:
