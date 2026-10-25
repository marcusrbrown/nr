# Knocked-down grunts that look translucent (unit6 `waves-f1600.png`)

Result: **the renderer draws the grunts opaque.** No alpha, blend or depth setting is wrong and the atlas pipeline
(`tools/render/post.mjs`) writes binary alpha, so nothing in it was changed and no atlas was re-rendered. What reads as
translucency is the lit shading of the knockdown frame. A change to it is an art decision, listed at the end for the owner.

Scene: tick 1600 of `input-waves.json` on the waves build, two grunts lying across each other (screen 1113..1286 x 672..890).
The experiment builds below were temporary edits of `main.c` (hide an actor, clear colour, arena off, flat normals) and are
not committed; the images and the scripts that measured them are here.

| Check | Measurement | Artifact |
| --- | --- | --- |
| Atlas alpha | `grunt.png`, `hero.png`, `heavy.png` have exactly two alpha values (0 and 255) and no texel in between: 56409, 293719 and 145919 opaque texels, 0 partial | `atlas-alpha.txt` |
| Normal sheets | every texel under opaque colour has a unit normal (length 0.993 to 1.007) and an opaque alpha; none is zero or partial | `atlas-alpha.txt` |
| Material | `anim.c` sets `alpha_test = 0.5` and leaves `transparent` and `depth_write` at the three.c defaults (opaque, writes depth) | `anim.c:113` |
| Blending | every non-background pixel of a grunt over a white clear is identical to the same pixel over a black clear: 159012 pixels, 0 differing, max channel difference 0 | `bgcmp.txt`, `2-over-white-arena-hidden.png` |
| Arena | the same 159012 pixels are identical with the street block drawn and with it hidden | `bgcmp.txt` |
| Overlap | the two grunts' silhouettes share 5652 pixels; each of them is exactly the pixel the front grunt (id 7) draws alone, 0 show the back grunt, 0 are a mix | `overlap.txt`, `4-actor7-alone.png`, `5-actor8-alone.png` |

So the front body's pixels do not depend on what is behind them. The soft edges and the see-through impression are in the
front body's own pixels:

* With the baked normal maps (`1-before-lit.png`) the knocked-down torso fades over about 10 scene pixels from the shirt's
  grey to the dark of the street at its back, and the back grunt's shirt, trousers and shoes are the same colours, so the
  fade reads as the front body dissolving into the one behind.
* With flat normals (`3-flat-normals.png`) the same silhouette has hard shade steps and no fade.
* Luminance of the front grunt's silhouette, lit against flat normals, by distance from its edge (`rim.json`, `rim.mjs`):
  0.83 at 1-3 screen pixels, 0.90 at 4-6, 0.92 to 0.95 from 7 on. The baked normals take about 12% off the outermost scene
  pixels and 5 to 8% off the interior.

## What would change the look (not done; owner's call)

1. Flatten the normals in the outermost 2 to 3 texels of each frame in `post.mjs` (blend toward the view direction), and
   re-render `hero`, `grunt` and `heavy`. The edge ratio above goes to about 1.0. It changes all three sheets, their hashes
   in `PROVENANCE.md` and the Unit 3 and Unit 6 evidence that quotes them, and it changes every character's look, which the
   look gate in Unit 8 judges.
2. Give a lying body its own tint or a darker outline so two overlapping bodies separate (a render recipe change, same cost).
3. Leave it: the bodies are opaque and correctly ordered.

Recommendation: 3 for this slice, and 2 if the owner still reads the overlap as translucent when the HUD and screens are in.
