# nr arena asset provenance

No third-party assets. The street block is generated geometry:

| File | Source |
| --- | --- |
| `layout.json` | Written by `gen-arena.mjs` (`node games/nr/assets/arena/gen-arena.mjs`; `--check` exits 1 when the committed file differs from what the script writes). A fixed-seed integer generator and values rounded to 1/1000, so the output is the same on every machine. The file lists boxes, planes and flat decals: world position, size, colour, optional emissive colour and intensity. |
| `lights.json` | Written by hand: the ambient fill and the four point lights' colours, intensities and sweep, flicker and buzz patterns (`arena_lights_at` in `games/nr/arena.c` reads it). |
| `gen-arena.mjs` | Written for this repository (MIT). It is a tool: the game packs `layout.json` and `lights.json` only (`assets/roots.txt`). |

The art licence of the repository (README) covers the generated geometry and the light patterns.
