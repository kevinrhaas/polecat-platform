#!/usr/bin/env node
// stamp-changelog.mjs — fill in what the author could not know: the ship time
// and the version number of the newest entries in site/js/changelog.js.
//
// Fleet contract: docs/SHELL-API.md § the fleet changelog contract. Authors
// prepend `{ v: null, ts: '', date: '', … }` and this tool assigns both, before
// merge — nothing stamps afterwards. Every app repo owns an equivalent tool
// (games tools/stamp-changelog.mjs; jobtracker/relay/autoselector/manager
// .github/stamp-changelog.mjs; analytics tools/changelog-normalize.js; custom
// chicago/4d/tools/stamp-changelog.mjs); this is polecat-platform's own copy.
//
// Why `v` is assigned rather than authored: two branches that each prepend an
// entry both compute the same "top + 1", and whichever merges second is
// silently wrong. Assignment happens here, after the merge, where the real
// answer is knowable. See the contract doc for the `.gitattributes` half.
//
// Usage: node scripts/stamp-changelog.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'site', 'js', 'changelog.js');

let src = readFileSync(FILE, 'utf8');
const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

// 1) Timestamps.
let stamped = 0;
src = src.replace(/ts:\s*''/g, () => { stamped++; return `ts: '${now}'`; });

// 2) Version numbers, by targeted replacement rather than re-serialising the
//    file. Rewriting it wholesale would reformat entries this tool did not
//    author, and the fleet parses this file with a bracket walker that a
//    reformat is exactly the wrong thing to surprise.
//
//    The numbered entry nearest the top is the base; unnumbered entries above
//    it are numbered upward from it, oldest first, so the topmost ends highest.
//    Entries that already carry a version are never touched — Manager keys its
//    release rows on `v` and `polecat.whatsnew.seen` compares against it, so
//    renumbering history would re-notify every reader.
const nulls = [...src.matchAll(/v:\s*null/g)];
let numbered = 0;
if (nulls.length) {
  const firstNumbered = src.match(/v:\s*(\d+)/);
  const base = firstNumbered ? Number(firstNumbered[1]) : 0;
  // Replace bottom-up so each earlier (lower) entry gets the smaller number,
  // and so the indices from matchAll stay valid as we splice.
  for (let i = nulls.length - 1, n = base; i >= 0; i--) {
    const m = nulls[i];
    const v = ++n;
    src = src.slice(0, m.index) + `v: ${v}` + src.slice(m.index + m[0].length);
    numbered++;
  }
}

// 3) Refuse to write a file the contract would reject. A stamper that emits a
//    duplicate version is worse than one that stops: the duplicate ships.
const versions = [...src.matchAll(/v:\s*(\d+)/g)].map((m) => Number(m[1]));
for (let i = 1; i < versions.length; i++) {
  if (versions[i - 1] <= versions[i]) {
    console.error(`stamp-changelog: versions are not strictly decreasing `
      + `(v${versions[i - 1]} then v${versions[i]}) — refusing to write.`);
    process.exit(1);
  }
}

if (!stamped && !numbered) {
  console.log('stamp-changelog: nothing to do (no empty ts, no null v)');
} else {
  writeFileSync(FILE, src);
  console.log(`stamp-changelog: stamped ${stamped} timestamp(s) with ${now}`
    + `, assigned ${numbered} version(s); top is v${versions[0]}`);
}
