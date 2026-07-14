#!/usr/bin/env node
// gen-manifest.mjs — stamps lib/MANIFEST.json: { version, files: {path: sha256} }.
//
// Run before tagging a shell release (and in the same commit as any lib/
// change). App repos carry this manifest inside vendor/polecat-shell/, which
// is how fleet sweeps detect local edits to the vendored copy: hash mismatch
// = someone patched the vendor dir instead of the platform repo.
//
// Usage: node scripts/gen-manifest.mjs

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIB = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib');

function walk(dir){
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    if(statSync(p).isDirectory()) return name === 'demo' ? [] : walk(p); // demo isn't vendored
    return [p];
  });
}

const files = {};
for(const p of walk(LIB).sort()){
  const rel = relative(LIB, p).replaceAll('\\', '/');
  if(rel === 'MANIFEST.json') continue;
  files[rel] = createHash('sha256').update(readFileSync(p)).digest('hex');
}

const version = readFileSync(join(LIB, 'VERSION'), 'utf8').trim();
writeFileSync(join(LIB, 'MANIFEST.json'), JSON.stringify({ version, files }, null, 2) + '\n');
console.log(`MANIFEST.json: shell v${version}, ${Object.keys(files).length} files`);
