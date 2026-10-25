# Unit 2 look-gate checklist (owner review)

Captures in this directory, one set taken on the native binary on WebGPU (the cart on WebGPU produces the same
pixels; `captures.json` records the per-host size and equality): `stage-f60.png`, `stage-f120.png`, `stage-f180.png`,
`stage-f240.png` (three heroes sharing one frame at the belt's left, centre and right, one walking a lane nearer; the
three neon lights sweeping) and `solo_0-f60.png`, `solo_1-f60.png`, `solo_2-f60.png` (the hero idle under only neon
light 0, 1 or 2). The lit-side and silhouette inputs are not committed (see README.md).

Mark each when reviewed, and say what to tune in tools/render/profiles/hero.json or in the lights:

- [x] Hero silhouette reads at 640x360 scene resolution (head, arms, legs distinguishable)
  - The shoes are too close in color, the pants look like leggings, the pink strip on the back of the pants is pink like the hair and distracting (change color), the4re is a mask or something over the hero's eye that is difficult to read and looks like stray pixels; same for the left side, there's a light blue strip that might be part of the jacket that looks pixelated and broken
- [x] Neon colour retexture: jacket, trim, gloves, boots, belt, visor read as intended
  - Colors are muddy and the clothes lack detail, the character looks like an NPC, not a hero
- [x] Hero height: ~128 scene px of a 360 px frame (the current density)
- [x] Each neon light's colour reads on the hero's lit side (solo_0 magenta, solo_1 cyan, solo_2 amber)
  - The entire scene is a bit dimly lit but the neon lights are still clearly visible
- [x] Normal map reads as form shading, not noise, and the lit side follows the moving lights in stage-f60..f240
  - The entire character is low-detail so I can't fully judge the normal map's accuracy
- [x] Hero at the far left and far right of the belt is not visibly distorted
- [x] Nearest-neighbour 3x upscale looks crisp (no filtering seams) on the native captures
  - These captures do not exist, there are no -f120 or -f240 png files in this folder (round 2: stage-f120.png and stage-f240.png are in this folder now)
- [x] The cart captures show the same scene as native (host output sizes are in captures.json)
- [x] Ground and wall backdrop are placeholders; judge the hero, not the street

The camera angle is tuned against Unit 4's occlusion and scroll captures.

## Round 2 (hero retuned from the notes above)

Changes to answer the notes, to be judged on `stage-f60..f240.png` and `solo_*-f60.png`:

- [ ] Shoes and trousers separate: white sneakers against near-black boot shafts and mid-navy trousers
- [ ] Trousers read as baggy cargo legs, not leggings (wider thigh and shin volumes, white knee pads, a side pocket)
- [ ] No pink on the back of the legs: the pink is the hair only; the back has a navy pack with a cyan band
- [ ] No visor, mask or eye strip; the head is skin and hair
- [ ] No broken light-blue side strip: the jacket is one navy body with a lighter yoke, cyan pauldron discs and a white belt with a cyan buckle
- [ ] Hero reads as a hero: dark base clothing, two accents (cyan and white), pink hair, silhouette breaks at shoulders, pack, belt and knees
- [ ] Scene fill raised (ambient 0x7482a8, ground and wall lighter); neon colours still set the colour of the lit side
- [ ] Normal map judged now that the figure has more form
