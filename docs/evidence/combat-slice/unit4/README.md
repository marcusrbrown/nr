# Unit 4 evidence: street block, lights and belt camera

Produced by `games/nr/tests/` against `games/nr` (the `nr` app: the street block, two players, two stand-in actors).

Hosts. As in Unit 2: the pictures come from the native binary on WebGPU (Dawn on Metal, offscreen) and the same set from
the dual cart (`build/cart-wgpu`) in headless Chromium on WebGPU; `captures.json` carries, per capture, the cart's size
against the native's, whether the pixels are identical and whether the simulation state is equal. The GL runs (native
binary on GL, `build/cart` in headless Chromium on GL) write no pictures: they run the whole input script and record
`cw.three.missing`, the sizes and the state checksum under `gl`.

| Scenario | Result | Artifact |
| --- | --- | --- |
| Parallax: the camera moves 4.44 units over ticks 352 to 426; layers shift less the farther they are | pass: play lane pillar band 879 screen px, near shop sign 780 (x0.887; the belt camera predicts 0.885), far tower sign 695 (x0.791; predicted 0.787); each measured shift within 8 px of the projected one; an actor's world shift for the move is 852 px at the centre lane | `scroll-check.txt`, `scroll-report.json` |
| AE6: the pillar occludes the actor behind it, the actor in front occludes the pillar | pass: of 964 pixels where the actor behind (lane -1.08) and the pillar's front face overlap none shows the actor; of 2146 where the actor in front (lane 1.35) overlaps it all show the actor; both actors are visible away from the pillar (share 1.000) | `ordering-check.txt`, `ordering-result.json`, `ordering-overlap.png` (green: actor visible, magenta: occluded) |
| AE6 control: reversed depth mapping fails | fail as required: exit 1; the actor behind is drawn in front of the pillar (z 2.91, so it no longer overlaps the face: 0 overlap pixels, below the 150 the check needs) and the actor in front is clipped by the pillar's face (0.614 visible of 2416) | `ordering-control.txt`, `ordering-control.json` (build: `cmake -DNR_REVERSE_DEPTH=ON`) |
| AE4 and AE8: trailing player at the left edge stops the scroll, the leader stops at the soft wall | pass: tick 230, trailing player x 0.091 at the left edge of the frame, leader x 9.191 at the right edge, camera 4.800 and unchanged since tick 142; the gap is 9.10 units | `scroll-check.txt` |
| Both players at one x: camera centred, no jitter over 60 idle ticks | pass: both at x 0, camera 0 at ticks 1 and 61 | `scroll-check.txt` |
| The camera never scrolls back; every player stays in frame; the street ends at the arena's right bound | pass at 17 ticks of the script: camera monotonic and equal to `cam_left`; every player within the frame's half width at its lane; at tick 760 the camera is at 20 and both players at x 24 | `scroll-check.txt` |
| `cw.three.missing == 0` with the lights sweeping over the whole belt | pass: 0 on native WebGPU and cart WebGPU at ticks 61, 232, 352, 426, 640 (scroll) and 243 (pillar), and on native GL and cart GL over all 760 (scroll) and 300 (pillar) frames; the lights' x spans -0.7 to 24.8 over the script, the flash slot stays at 0; state checksum equal on the GL hosts | `captures.json`, `scroll-check.txt` |
| Cart pictures against native | identical pixels and equal simulation state at every capture (7 captures) | `captures.json` |
| Program tables | the street block adds `standard+instbig+l0400`; all four rows are reached by `nr` on the idle input; removing each gives `cw.three.missing == 1` naming exactly that row, the baseline 0 | `programs-controls.json`, `games/nr/programs/` |
| romdev: dual cart on WebGPU, conformance, two-player scroll, state against native | pass: `gpu "webgpu"`, conformance, 640 ticks of `input-scroll.json` with the load frame counted, `nr.checksum` 3091896195 equal to the native's, `cw.gpu.api` 2, errors 0, missing 0; a 60 s `host{play}` of the street followed | `romdev/` |
| Unit 2 checks on the stage they were written for (`nr_stage`) | pass: `stage-check.mjs` and `lit-side-check.mjs` | `unit2-stage-check.txt`, `unit2-lit-side-check.txt` |

Committed: the review pictures (`scroll-f61|232|352|426|640.png`, `pillar-f243.png`, `pillar_bare-f243.png`; the
`pillar_bare` picture is the same street and lights with no actors, the reference `ordering-check.mjs` compares against)
and their reduced states (`nr.*`, `cw.three.*`, `cw.gpu.*`). The input scripts are `games/nr/tests/input-scroll.json`
(both players walk right, the trailing one then walks back to the left edge, then both cross the street) and
`input-pillar.json` (one player behind the pillar, a stand-in in front of it). They regenerate with

    CW_TEST_GPU=desktop node games/nr/tests/look-captures.mjs --out out/unit4/caps --only scroll,pillar --publish docs/evidence/combat-slice/unit4
    CW_TEST_GPU=desktop node games/nr/tests/scroll-check.mjs --dir out/unit4/caps --report docs/evidence/combat-slice/unit4/scroll-report.json
    CW_TEST_GPU=desktop node games/nr/tests/ordering-check.mjs --publish docs/evidence/combat-slice/unit4
    node games/nr/tests/romdev-scroll.mjs

## Owner checklist (belt scroll and occlusion captures)

Look at `scroll-f61|232|352|426|640.png` and `pillar-f243.png`; each line is yes or no.

- [ ] The street reads as one block three screens wide: shop fronts, a second row of buildings above them, a skyline behind.
- [ ] The three neon lights wash the shop fronts and the actors in their colours, and move over the street as it scrolls.
- [ ] The layers shift at visibly different rates when the camera scrolls (compare `scroll-f352.png` and `scroll-f426.png`).
- [ ] The pillar hides the player behind it and the stand-in in front of it hides the pillar (`pillar-f243.png`).
- [ ] The camera holds both players in frame; the leader stops at the right edge (`scroll-f232.png`).
- [ ] The hero is readable at 128 px against the street; the street is neither too dark nor too busy to read actors.

Known limits of this step: the actors do not face left (facing is the Unit 5 clip work), the stand-ins at x 11.7 and on the
patrol are not enemies, and the street's windows and signs are flat emissive boxes (no textures).
