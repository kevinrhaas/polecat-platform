#!/usr/bin/env node
// stamp-changelog.mjs — fills empty `ts: ''` entries in site/js/changelog.js
// with the current time (ISO-8601 UTC), matching the fleet's changelog
// contract (docs/SHELL-API.md § the fleet changelog contract): ts is left
// empty by authors and stamped before merge by the shipping agent running
// this tool — same pattern as every app repo's own stamp tool (games
// tools/stamp-changelog.mjs; jobtracker/relay/autoselector
// .github/stamp-changelog.mjs; analytics tools/changelog-normalize.js;
// polecat-app its generator), just polecat-platform's own copy.
//
// Usage: node scripts/stamp-changelog.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'site', 'js', 'changelog.js');

const src = readFileSync(FILE, 'utf8');
const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

let count = 0;
const stamped = src.replace(/ts:\s*''/g, () => { count++; return `ts: '${now}'`; });

if (count === 0) {
  console.log('stamp-changelog: nothing to stamp (no empty ts entries)');
} else {
  writeFileSync(FILE, stamped);
  console.log(`stamp-changelog: stamped ${count} entr${count === 1 ? 'y' : 'ies'} with ${now}`);
}
