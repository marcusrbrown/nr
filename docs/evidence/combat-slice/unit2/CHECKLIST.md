# Unit 2 look-gate checklist (owner review)

Captures in this directory, per host (native-gl, cart-gl, cart-wgpu, native-wgpu): `stage-<host>-f60|120|180|240.png`
(three heroes sharing one frame at the belt's left, centre and right, one walking a lane nearer; the three neon lights
sweeping), `solo_<n>-<host>-f60.png` (the hero idle under only neon light n), `lit_*` (the lit-side check's builds),
`bare-<host>-f60.png` (the stage without heroes).

Mark each when reviewed, and say what to tune in tools/render/profiles/hero.json or in the lights:

- [x] Hero silhouette reads at 640x360 scene resolution (head, arms, legs distinguishable)
  - The shoes are too close in color, the pants look like leggings, the pink strip on the back of the pants is pink like the hair and distracting (change color), the4re is a mask or something over the hero's eye that is difficult to read and looks like stray pixels; same for the left side, there's a light blue strip that might be part of the jacket that looks pixelated and broken
- [x] Neon colour retexture: jacket, trim, gloves, boots, belt, visor read as intended
  - Colors are muddy and the clothes lack detail, the character looks like an NPC, not a hero
- [x] Hero height: ~128 scene px of a 360 px frame (the density lock)
- [x] Each neon light's colour reads on the hero's lit side (solo_0 magenta, solo_1 cyan, solo_2 amber)
  - The entire scene is a bit dimly lit but the neon lights are still clearly visible
- [x] Normal map reads as form shading, not noise, and the lit side follows the moving lights in stage-*-f60..240
  - The entire character is low-detail so I can't fully judge the normal map's accuracy
- [x] Hero at the far left and far right of the belt is not visibly distorted
- [x] Nearest-neighbour 3x upscale looks crisp (no filtering seams) on the native captures
  - These captures do not exist, there are no -f120 or -f240 png files in this folder
- [x] The cart captures show the same scene as native (host output sizes are in captures.json)
- [x] Ground and wall backdrop are placeholders; judge the hero, not the street

The camera lock waits for Unit 4's occlusion and scroll captures.
