import { readFileSync } from 'node:fs';
import { decodePng } from '/Users/mrbrown/src/github.com/marcusrbrown/nr/tools/render/post.mjs';
const L = (f) => decodePng(readFileSync(`/Users/mrbrown/src/github.com/marcusrbrown/nr/out/unit7/${f}-f1600.png`));
const w = L('bgwhite'), b = L('bgblack');
let bothBg = 0, bothFg = 0, differ = 0, maxd = 0, hist = {};
for (let i = 0; i < w.width * w.height; i++) {
  const pw = [0,1,2].map((k)=>w.data[i*4+k]), pb = [0,1,2].map((k)=>b.data[i*4+k]);
  const wBg = pw.every((v)=>v===255), bBg = pb.every((v)=>v===0);
  if (wBg && bBg) { bothBg++; continue; }
  if (wBg !== bBg) { differ++; continue; }
  const d = Math.max(...pw.map((v,k)=>Math.abs(v-pb[k])));
  if (d) { differ++; maxd = Math.max(maxd,d);} else bothFg++;
}
console.log({ backgroundBothRuns: bothBg, actorPixelsIdenticalOverWhiteAndBlack: bothFg, actorPixelsDiffering: differ, maxChannelDiff: maxd });
