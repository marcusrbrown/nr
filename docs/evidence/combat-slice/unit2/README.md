# Unit 2 evidence: look checkpoint

Produced by `games/nr/tests/` against `games/nr` (the hero's idle and walk, three heroes on a shared frame plus one
walking, the four-light belt scene).

Hosts. The pictures come from the native binary on WebGPU (Dawn on Metal, offscreen) and the same set from the dual
cart (`build/cart-wgpu`) in headless Chromium on WebGPU; they are one content seen by two hosts, so `captures.json`
carries one entry per capture with the cart's size against the native's, whether the pixels are identical (and, when
not, how many differ and by how much) and whether the simulation state is equal. The GL runs (native binary on GL and
`build/cart` in headless Chromium on GL) write no pictures: they run every app and record `cw.three.missing`, the sizes
and the state checksum under `gl`.

| Scenario | Result | Artifact |
| --- | --- | --- |
| Hero idle/walk step on the manifest's durations | pass: steps match `floor(tick*1000/(ms*60))` at ticks 60/120/180/240 on native and cart and at ticks 7, 8, 14, 15, 16 natively (idle 250 ms steps 0 to 1 at tick 15; walk 120 ms at tick 8) | `stage-check.txt`, `stage-report.json` |
| Lit side follows a horizontal and a vertical light sweep, non-instanced hero, >= 2x the flat control | pass: swing ratios 3.27x to 3.68x horizontal and 7.62x to 8.91x vertical, on native and cart, signs as expected after subtracting the flat control's per-frame offset, `cw.three.missing` 0 | `lit-side-check.txt`, `lit-side-report.json` |
| `cw.three.missing == 0` on native, cart GL, cart WebGPU; instanced and non-instanced `l0400` rows reached | pass: 0 in every run (`captures.json`); row-removal controls: each of the three rows removed gives missing 1 naming exactly that row, baseline 0 | `captures.json`, `programs-controls.json` |
| Two heroes on different frames render distinct frames | pass: heroes 0-2 on atlas frame 4, hero 3 on frame 8 | `stage-check.txt` |
| Far-left and far-right hero undistorted | pass: silhouette width 50 scene px at x = -3.9, 0, +3.9 on native and cart; IoU with the projected atlas alpha 0.999 to 1.000 | `stage-check.txt` |
| Native screenshot is a 3x nearest upscale | pass: 0 of 230400 3x3 blocks mix colours | `stage-check.txt` |
| Output size per host | native, cart and the GL state runs: 1920x1080 capture, drawable and render size 640x360, pixel_scale 3 | `stage-check.txt`, `captures.json` |
| Cart pictures against native | identical pixels and equal simulation state at stage f60/f120/f180/f240 | `captures.json`, `stage-check.txt` |
| romdev: dual cart on WebGPU and GL, conformance, debug-state whitelist | pass: `gpu "webgpu"`/`"gl"`, `cw.gpu.api` 2/1, errors 0, missing 0, ticks 60, 15 whitelisted fields present | `romdev/` (calls and states) |

Committed: the review pictures (`stage-f60|120|180|240.png`, `solo_0|1|2-f60.png`) and their reduced states (`nr.*`,
`cw.three.*`, `cw.gpu.*`). The check inputs (lit sweeps, bare stage; 24 capture runs on two hosts and 9 GL state runs)
regenerate with

    CW_TEST_GPU=desktop node games/nr/tests/look-captures.mjs --out out/unit2/caps --publish docs/evidence/combat-slice/unit2
    node games/nr/tests/lit-side-check.mjs --dir out/unit2/caps
    node games/nr/tests/stage-check.mjs --dir out/unit2/caps
    node games/nr/tests/programs-controls.mjs

`CHECKLIST.md` is the owner's review checklist for the captures.
