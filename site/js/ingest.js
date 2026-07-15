// ingest.js — live fleet status for the launcher grid.
//
// Every Polecat app publishes /js/changelog.js in the fleet format (see
// docs/SHELL-API.md). This module pulls that file and reads the latest
// version + ship time WITHOUT executing remote code: the array literal is
// extracted from the raw text and converted to strict JSON, so a malformed
// (or hostile) file can only fail to parse, never run. Ported from
// manager.polecat.live js/ingest.js — the production-proven parser.
//
// Results are cached in localStorage with a TTL so the launcher paints
// instantly on repeat visits and degrades gracefully offline: no cache, no
// network → the card renders from the static catalog alone.

const CACHE_KEY = 'polecat.launcher.status.v1';
const TTL_MS = 10 * 60 * 1000; // 10 minutes

// Find the `[ … ]` array literal following `NAME = `, respecting nested
// brackets and quoted strings so we grab exactly the array (not past it).
function extractArrayLiteral(src, varName){
  const m = src.match(new RegExp(varName + '\\s*=\\s*\\['));
  if(!m) return null;
  const start = m.index + m[0].length - 1;
  let depth = 0, inStr = null, esc = false;
  for(let i = start; i < src.length; i++){
    const c = src[i];
    if(inStr){
      if(esc) esc = false;
      else if(c === '\\') esc = true;
      else if(c === inStr) inStr = null;
      continue;
    }
    if(c === '"' || c === "'" || c === '`'){ inStr = c; continue; }
    if(c === '[') depth++;
    else if(c === ']'){ depth--; if(depth === 0) return src.slice(start, i + 1); }
  }
  return null;
}

// JS-object-literal → strict JSON, string-aware (see manager ingest.js for
// the war stories this structure encodes: comment stripping, trailing-comma
// trimming and bare-key quoting must never run inside string values).
function jsLiteralToJSON(lit){
  let out = '', struct = '', i = 0;
  const n = lit.length;
  const esc = (ch) => ch === '"' ? '\\"' : ch;
  const flush = () => {
    if(!struct) return;
    out += struct
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g, '$1"$2":');
    struct = '';
  };
  while(i < n){
    const c = lit[i];
    if(c === '/' && lit[i+1] === '/'){ while(i < n && lit[i] !== '\n') i++; continue; }
    if(c === "'" || c === '"'){
      flush();
      const quote = c; i++; let s = '"';
      while(i < n){
        const ch = lit[i];
        if(ch === '\\' && i+1 < n){
          const next = lit[i+1];
          if(next === '\\') s += '\\\\';
          else if('ntrbf'.includes(next)) s += '\\' + next;
          else s += esc(next);
          i += 2; continue;
        }
        if(ch === quote){ i++; break; }
        s += esc(ch); i++;
      }
      out += s + '"'; continue;
    }
    struct += c; i++;
  }
  flush();
  return JSON.parse(out);
}

export function parseChangelogSource(text){
  const lit = extractArrayLiteral(text, 'CHANGELOG');
  if(!lit) throw new Error('No CHANGELOG array found');
  const arr = jsLiteralToJSON(lit);
  if(!Array.isArray(arr) || !arr.length) throw new Error('empty CHANGELOG');
  // Newest-first by convention, but don't trust ordering blindly.
  const newest = arr.reduce((a, b) => (Number(b.v) || 0) > (Number(a.v) || 0) ? b : a);
  return {
    v: Number(newest.v) || 0,
    title: String(newest.title || '').slice(0, 200),
    ts: newest.ts && !isNaN(new Date(newest.ts)) ? new Date(newest.ts).toISOString() : null,
  };
}

function readCache(){
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); }
  catch { return {}; }
}
function writeCache(cache){
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch {}
}

// Fetch one app's latest release info, TTL-cached. Never throws — returns
// null when the app can't be reached (the card just skips the live row).
export async function appStatus(app, { force = false } = {}){
  if(!app.changelogUrl) return null;
  const cache = readCache();
  const hit = cache[app.id];
  if(!force && hit && (Date.now() - hit.at) < TTL_MS) return hit.status;
  try{
    const res = await fetch(app.changelogUrl, { mode: 'cors', cache: force ? 'no-store' : 'default' });
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const status = parseChangelogSource(await res.text());
    cache[app.id] = { at: Date.now(), status };
    writeCache(cache);
    return status;
  }catch{
    return hit ? hit.status : null; // stale beats nothing; nothing beats a broken card
  }
}
