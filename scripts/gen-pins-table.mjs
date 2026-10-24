#!/usr/bin/env node
// Render scripts/deps.lock (the only hand-edited source of pins) as a Markdown table or JSON.
//
//   node scripts/gen-pins-table.mjs                    table to stdout
//   node scripts/gen-pins-table.mjs --json             pins as JSON to stdout
//   node scripts/gen-pins-table.mjs --update <file>    replace the block between the pins markers in <file>
//   node scripts/gen-pins-table.mjs --check <file>     exit 1 if that block differs from the lock
//
// The markers in <file> are `<!-- pins:begin -->` and `<!-- pins:end -->`.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BEGIN = '<!-- pins:begin -->';
const END = '<!-- pins:end -->';

export function parseLock(text) {
  return text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => {
    const [name, source, version, pin = ''] = l.split(/\s+/);
    return { name, source, version, pin: pin === '-' ? '' : pin };
  });
}

// archives pin a sha256, git sources a full commit
const pinKind = (p) => (/^[0-9a-f]{64}$/.test(p) ? 'sha256' : /^[0-9a-f]{40}$/.test(p) ? 'commit' : '');

export function renderTable(pins) {
  const rows = pins.map((p) => {
    const kind = pinKind(p.pin);
    const pin = p.pin ? `${kind} \`${p.pin}\`` : p.name.startsWith('observed:') ? 'observed' : '';
    return `| \`${p.name}\` | ${p.version} | ${p.source} | ${pin} |`;
  });
  return ['| Name | Version | Source | Pin |', '| --- | --- | --- | --- |', ...rows].join('\n');
}

const lockPath = join(ROOT, 'scripts', 'deps.lock');
export const readPins = () => parseLock(readFileSync(lockPath, 'utf8'));

function splice(doc, table) {
  const b = doc.indexOf(BEGIN);
  const e = doc.indexOf(END);
  if (b < 0 || e < b) throw new Error(`markers ${BEGIN} / ${END} not found`);
  return `${doc.slice(0, b + BEGIN.length)}\n${table}\n${doc.slice(e)}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [flag, file] = process.argv.slice(2);
  const pins = readPins();
  if (flag === '--json') console.log(JSON.stringify(pins, null, 2));
  else if (flag === '--update' && file) writeFileSync(file, splice(readFileSync(file, 'utf8'), renderTable(pins)));
  else if (flag === '--check' && file) {
    const doc = readFileSync(file, 'utf8');
    if (splice(doc, renderTable(pins)) !== doc) { console.error(`${file}: pins table differs from scripts/deps.lock`); process.exit(1); }
  } else if (!flag) console.log(renderTable(pins));
  else { console.error('usage: gen-pins-table.mjs [--json | --update FILE | --check FILE]'); process.exit(2); }
}
