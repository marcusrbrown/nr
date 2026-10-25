# Combat slice evidence

Plan: `docs/plans/2026-10-24-002-feat-combat-slice-plan.md`. Decisions: `docs/decisions/0002-render-pipeline-and-look.md`.
Per-unit artifacts sit in `unit2/`, `unit3/` and so on. The gate verdicts and the owner's look checklist join this file
in Unit 8.

## Unit 3: hero clip set, render time and atlas size

Measured on the development Mac (Apple Silicon, macOS 15, 10 cores), Blender 4.5.15 Cycles on the CPU, 1 sample,
supersample 4 (a 640x640 render per 160x160 frame), two passes per frame (albedo, normal). `render-times.json` holds
the per-slot wall-clock of two full runs; `clips-check.json` holds the sheet figures.

| Clip | Frames | ms/frame | Clip ms | Render s (run 1 / run 2) | Render ms per frame | Sheet KiB (colour + normal) | Page |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| idle | 8 | 250 | 2000 | 1.10 / 1.04 | 134 | 1,600 | 0 |
| walk | 8 | 120 | 960 | 1.03 / 1.06 | 131 | 1,600 | 0 |
| run | 8 | 90 | 720 | 1.13 / 1.25 | 149 | 1,600 | 0 |
| hit1 | 6 | 60 | 360 | 0.96 / 0.92 | 157 | 1,200 | 0 |
| hit2 | 6 | 60 | 360 | 0.82 / 0.82 | 137 | 1,200 | 0 |
| hit3 | 7 | 60 | 420 | 0.99 / 1.01 | 143 | 1,400 | 0 |
| jump | 6 | 100 | 600 | 0.77 / 0.80 | 131 | 1,200 | 0 |
| throw | 6 | 80 | 480 | 0.82 / 0.86 | 140 | 1,200 | 0 |
| hurt | 4 | 80 | 320 | 0.55 / 0.55 | 138 | 800 | 0 |
| knockdown | 8 | 90 | 720 | 1.14 / 1.07 | 138 | 1,600 | 0 |
| getup | 6 | 90 | 540 | 0.77 / 0.84 | 135 | 1,200 | 0 |
| dash | 6 | 70 | 420 | 0.86 / 0.90 | 147 | 1,200 | 0 |
| special_knockback | 9 | 70 | 630 | 1.12 / 1.27 | 133 | 1,800 | 0 |
| special_dash | 8 | 60 | 480 | 1.07 / 1.23 | 144 | 1,600 | 0 |
| **total** | **96** | | 9010 | 13.13 / 13.63 | 139 | 19,200 | |

- `jumpkick` and `grab` are the owner's hand-keyed clips: placeholder entries in the profile (not ready, no segments, a
  `handKey` note) that the renderer refuses with exit 12, and gap slots in the clip table in `games/nr/anim.c`. They are
  not in the atlas.
- One 1920x1280 page per sheet (12 columns of 160 px, 8 rows), colour and normal alike: 96 of the 144 cells a 2048 page
  holds. 9.375 MiB per sheet, 18.75 MiB for the pair. A full hero render plus post-processing runs in about 20 s of
  wall-clock including Blender's start-up.
- Frame counts are the plan's estimate (the profile's `proposal` values); the budget below did not force a cut.

Atlas budget (written in ADR-0002): all colour and normal sheets of the three characters, decoded, 64 MiB.

| Character | Frames | Sheet pair, one page | MiB |
| --- | ---: | --- | ---: |
| hero, planned (96 rendered + 5 jumpkick + 5 grab) | 106 | 1920x1440 | 21.09 |
| grunt, 25 % of the planned hero | 27 | 1920x480 | 7.03 |
| heavy, 35 % of the planned hero | 38 | 1920x640 | 9.38 |
| total | 171 | | 37.50 |

The loader holds one decoded copy of each sheet (`t3_texture.pixels`) and decodes one sheet at a time, so the load peak
is the total plus the largest sheet: 48.0 MiB, against the 64 MiB budget and the 128 MiB wasm. These are computed from
sheet dimensions, not read from a wasm run (see Unverified).

### Unit 3 test scenarios

| Scenario | Result | Artifact |
| --- | --- | --- |
| Every clip has at least 4 frames and its pivot inside its rect | pass: 14 clips, 96 frames, pivot (80, 144) in every 160x160 rect; no silhouette within 3 px of a cell edge (x 15 to 155) | `unit3/clips-check.txt`, `unit3/clips-check.json` |
| Full-set render twice gives identical manifest and sheet hashes | pass: manifest, colour sheet and normal sheet byte-identical across two runs (and a third, the committed install); `inputs` and every `pixelsSha256` equal | `unit3/reproducibility.json`, `unit3/hero-profile-test.txt` |
| A clip beyond one page continues on the next page and the manifest records the page | pass: the same 96 raw frames packed at a 640 page size give 6 pages, `frames[].page = floor(index / 16)`, the clips crossing a page listed; the committed hero set has one page (the loader reads one) | `unit3/spill-pages.json`, `unit3/clips-check.txt` |
| A normal rect that differs from its colour rect fails naming the frame | pass: a normal cell swapped in from frame 70 fails `frame 5 (idle 5): the normal sheet's rect differs ... at texel (85, 22)`; a pivot outside its rect fails naming `frame 3 (idle 3)` | `unit3/rect-mismatch.txt`, `unit3/clips-check.txt` |
| The renderer refuses the two gap clips | pass: exit 12 `is not ready (a gap awaiting a hand-keyed action)` | `unit3/hero-profile-test.txt` |
| Clip table in `anim.c` matches the profile and the atlas | pass: 16 slots, 2 gaps, enum and table agree | `unit3/clips-check.txt` |
| The Unit 2 checks hold on the full atlas | pass: look captures on native and cart (WebGPU pictures, GL state runs) identical with `cw.three.missing` 0; lit-side swing ratios 8.98x to 9.81x horizontal and 7.27x to 8.28x vertical (floor 2x), signs as expected; stage check green (distinct frames, silhouette IoU 0.995 to 1.000, 3x nearest) | `unit3/unit2-checks/` |

Contact sheet for the owner's eye: `unit3/contact.png`, one row per clip, 4x nearest, the ground pivot in magenta.

Regenerate:

    OUT=out/unit3/final INSTALL=games/nr/assets/atlases tools/render/render-all.sh hero
    OUT=out/unit3/test PUBLISH=docs/evidence/combat-slice/unit3 node --test tools/render/tests/hero-profile.mjs
    node games/nr/tests/clips-check.mjs --out out/unit3/clips-check --publish docs/evidence/combat-slice/unit3

### Unverified in Unit 3

- Wasm resident memory with the full hero atlas is computed, not measured in a cart run. Unit 6 re-verifies the total
  with the three atlases loaded.
- Cross-machine render equality: the hashes are equal on this machine only, as ADR-0002 defines.
- The Unit 2 checks were run on a clean copy of HEAD plus the Unit 3 files (`main.c` unchanged from Unit 2), not on the
  working tree that Unit 4 is changing.
