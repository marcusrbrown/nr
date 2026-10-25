# Unit 2 evidence: look checkpoint

Produced by `games/nr/tests/` against `games/nr` (the hero's idle and walk, three heroes on a shared frame plus one
walking, the four-light belt scene). Hosts: `native-gl`, `cart-gl` (build/cart in headless Chromium on GL),
`cart-wgpu` (build/cart-wgpu in headless Chromium on WebGPU), `native-wgpu` (native binary, Dawn on Metal, offscreen).

| Scenario | Result | Artifact |
| --- | --- | --- |
| Hero idle/walk step on the manifest's durations | pass: steps match `floor(tick*1000/(ms*60))` at ticks 60/120/180/240 on 4 hosts and at ticks 7, 8, 14, 15, 16 natively (idle 250 ms steps 0 to 1 at tick 15; walk 120 ms at tick 8) | `stage-check.txt`, `stage-report.json` |
| Lit side follows a horizontal and a vertical light sweep, non-instanced hero, >= 2x the flat control | pass: swing ratios 3.38x to 5.12x on 4 hosts, both axes, signs as expected, `cw.three.missing` 0 | `lit-side-check.txt`, `lit-side-report.json` |
| `cw.three.missing == 0` on native, cart GL, cart WebGPU, instanced and non-instanced `l0400` rows reached | pass: 0 in all 96 runs (`captures.json`); row-removal controls: each of the three rows removed gives missing 1 naming exactly that row, baseline 0 | `captures.json`, `programs-controls.json` |
| Two heroes on different frames render distinct frames | pass: heroes 0-2 on atlas frame 4, hero 3 on frame 8, distinct pixels | `stage-check.txt`, `stage-native-gl-f60.png` |
| Far-left and far-right hero undistorted | pass: silhouette width 50 scene px at x = -3.9, 0, +3.9 on 4 hosts; IoU with the projected atlas alpha 0.988 to 0.995 | `stage-check.txt` |
| Native screenshot is a 3x nearest upscale | pass: 0 of 230400 3x3 blocks mix colours | `stage-check.txt` |
| Each cart host's output size | all four hosts: 1920x1080 capture, drawable and render size 640x360, pixel_scale 3: the engine does the upscale on every host measured | `stage-check.txt`, `captures.json` |
| romdev: dual cart on WebGPU and GL, conformance, debug-state whitelist | pass: `gpu "webgpu"`/`"gl"`, `cw.gpu.api` 2/1, errors 0, missing 0, ticks 60, 15 whitelisted fields present | `romdev/` (calls and states) |

Only the review set of PNGs is committed (stage f60 and f180 on every host, the solo-light captures on native-gl and
cart-wgpu). The check inputs (stage f120/f240, lit sweeps, bare stage, remaining solo captures; 96 runs) regenerate with

    CW_TEST_GPU=desktop node games/nr/tests/look-captures.mjs --out out/unit2/caps
    node games/nr/tests/lit-side-check.mjs --dir out/unit2/caps
    node games/nr/tests/stage-check.mjs --dir out/unit2/caps
    node games/nr/tests/programs-controls.mjs

State files here are reduced to the `nr.*`, `cw.three.*` and `cw.gpu.*` fields. `CHECKLIST.md` is the owner's review
checklist for the captures.
