#!/usr/bin/env node
// Write the current sha256 of a recipe's profile into the recipe (model.profileSha256), keeping the recipe's formatting.
//
//   node tools/render/pin-profile.mjs tools/render/recipes/hero.json
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const recipePath = resolve(process.argv[2] ?? '');
if (!process.argv[2]) { console.error('usage: pin-profile.mjs <recipe.json>'); process.exit(2); }
const text = readFileSync(recipePath, 'utf8');
const recipe = JSON.parse(text);
if (!recipe.model?.profile) { console.error('pin-profile: the recipe has no model.profile'); process.exit(1); }
const digest = createHash('sha256').update(readFileSync(resolve(dirname(recipePath), recipe.model.profile))).digest('hex');
const next = text.replace(/("profileSha256":\s*")[^"]*(")/, `$1${digest}$2`);
writeFileSync(recipePath, next);
console.log(`${recipe.model.profile}: ${digest}`);
