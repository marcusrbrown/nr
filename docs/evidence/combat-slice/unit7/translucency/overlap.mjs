import { readFileSync } from 'node:fs';
import { decodePng } from '/Users/mrbrown/src/github.com/marcusrbrown/nr/tools/render/post.mjs';
const L = (f) => decodePng(readFileSync(`/Users/mrbrown/src/github.com/marcusrbrown/nr/out/unit7/${f}-f1600.png`));
const base = L('base'), h8 = L('hide8'), h7 = L('hide7'), hb = L('hideboth');
const n = base.width * base.height;
const diff = (a, b, i) => Math.max(...[0,1,2].map((k) => Math.abs(a.data[i*4+k] - b.data[i*4+k])));
let sil7 = 0, sil8 = 0, both = 0, bothFront7 = 0, bothMatch7 = 0, bothMatch8 = 0, bothNeither = 0, maxAlphaLike = 0;
for (let i = 0; i < n; i++) {
  const in7 = diff(h8, hb, i) > 0, in8 = diff(h7, hb, i) > 0;
  if (in7) sil7++; if (in8) sil8++;
  if (in7 && in8) {
    both++;
    const m7 = diff(base, h8, i) === 0, m8 = diff(base, h7, i) === 0;
    if (m7) bothMatch7++; else if (m8) bothMatch8++; else bothNeither++;
  }
}
console.log({ sil7, sil8, overlapPx: both, overlapShows7Exactly: bothMatch7, overlapShows8Exactly: bothMatch8, overlapMixed: bothNeither });
