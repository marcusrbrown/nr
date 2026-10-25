# Unit 2 look-gate checklist (owner review)

Captures in this directory, per host (native-gl, cart-gl, cart-wgpu, native-wgpu): `stage-<host>-f60|120|180|240.png`
(three heroes sharing one frame at the belt's left, centre and right, one walking a lane nearer; the three neon lights
sweeping), `solo_<n>-<host>-f60.png` (the hero idle under only neon light n), `lit_*` (the lit-side check's builds),
`bare-<host>-f60.png` (the stage without heroes).

Mark each when reviewed, and say what to tune in tools/render/profiles/hero.json or in the lights:

- [ ] Hero silhouette reads at 640x360 scene resolution (head, arms, legs distinguishable)
- [ ] Neon colour retexture: jacket, trim, gloves, boots, belt, visor read as intended
- [ ] Hero height: ~128 scene px of a 360 px frame (the density lock)
- [ ] Each neon light's colour reads on the hero's lit side (solo_0 magenta, solo_1 cyan, solo_2 amber)
- [ ] Normal map reads as form shading, not noise, and the lit side follows the moving lights in stage-*-f60..240
- [ ] Hero at the far left and far right of the belt is not visibly distorted
- [ ] Nearest-neighbour 3x upscale looks crisp (no filtering seams) on the native captures
- [ ] The cart captures show the same scene as native (host output sizes are in captures.json)
- [ ] Ground and wall backdrop are placeholders; judge the hero, not the street

The camera lock waits for Unit 4's occlusion and scroll captures.
