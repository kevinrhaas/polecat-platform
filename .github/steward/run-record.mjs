#!/usr/bin/env node
/**
 * run-record.mjs — what a steward run actually picked up, and how it ended.
 *
 *   node run-record.mjs --stream /tmp/steward-stream.jsonl \
 *     [--resume /tmp/steward-stream.resume.jsonl] [--salvage /tmp/steward-salvage.txt] \
 *     --app custom --slice 2 --slices 5 --run-id 123 --run-url https://… \
 *     --status failure --json /tmp/steward-record.json --md /tmp/steward-record.md
 *   node run-record.mjs --self-test
 *
 * WHY THIS EXISTS. The journal entry for a run is the last 4000 characters of
 * whatever prose the agent happened to write, and the entries are not
 * comparable: one says "**T-0555**", the next "SLICE 1 of 5 → T-0554", the next
 * is an API error with no ticket at all. Five parallel slices post five entries
 * with identical headings. Reading the journal, the owner could not tell which
 * ticket a run had picked up, whether it opened a PR, or whether that PR merged
 * — which is the whole question the journal exists to answer.
 *
 * The facts were never missing. Every run already uploads its raw event stream,
 * and in it sit the exact commands: `node tools/ticket.mjs claim T-0531`,
 * `git push -u origin steward/t-0531-…`, `bash "$GHREST" pr-create … ` with the
 * PR number in its result, `pr-merge` with the merge sha in its. This reads
 * those rather than asking the agent to remember to say them — a run that dies
 * mid-sentence still gets an accurate record, and a run that writes a beautiful
 * summary cannot claim a merge it did not perform.
 *
 * It reports the RUN's actions, never its identity: the stream's init event
 * carries a model id and this never copies it (no model identifiers in repo
 * artifacts — the fleet rule).
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

/* ------------------------------------------------------------------ read */

/** Every JSON object in an NDJSON file. A truncated last line (a killed run) is
 *  skipped rather than fatal — a partial stream is exactly when a record is most
 *  wanted. */
export function readEvents(file) {
  if (!file || !existsSync(file)) return [];
  const out = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const s = line.trim();
    if (!s || s[0] !== '{') continue;
    try { out.push(JSON.parse(s)); } catch { /* half-written line at a kill */ }
  }
  return out;
}

/**
 * Tool calls with their results attached, plus the run's terminal result event.
 *
 * Results arrive as user turns carrying `tool_use_id`. Real streams have those
 * ids; some trimmed fixtures do not, so an id-less result attaches to the oldest
 * call still waiting for one — same order the CLI emits them in.
 */
export function collectTools(events) {
  const uses = [];
  const byId = new Map();
  let result = null;
  for (const ev of events) {
    if (ev.type === 'assistant') {
      for (const b of ev.message?.content || []) {
        if (b.type !== 'tool_use') continue;
        const use = { id: b.id ?? null, name: b.name, input: b.input ?? {}, result: null };
        uses.push(use);
        if (b.id) byId.set(b.id, use);
      }
    } else if (ev.type === 'user') {
      for (const b of ev.message?.content || []) {
        if (b.type !== 'tool_result') continue;
        const text = Array.isArray(b.content)
          ? b.content.map((c) => c.text || '').join('')
          : String(b.content ?? '');
        const hit = (b.tool_use_id && byId.get(b.tool_use_id)) || uses.find((u) => !u.result);
        if (hit) hit.result = { text: text.slice(0, 4000), is_error: !!b.is_error };
      }
    } else if (ev.type === 'result') {
      result = ev;
    }
  }
  return { uses, result };
}

/* --------------------------------------------------------------- extract */

const TICKET = String.raw`(T-\d{4})`;
// `\S` never crosses a newline, so a multi-line heredoc cannot smear one
// command's branch into the next command's match.
const rx = {
  claim: new RegExp(String.raw`ticket\.mjs\s+claim\s+${TICKET}`, 'g'),
  done: new RegExp(String.raw`ticket\.mjs\s+done\s+${TICKET}(?:[^\n]*?--pr\s+["']?(\d+))?`, 'g'),
  split: new RegExp(String.raw`ticket\.mjs\s+split\s+${TICKET}`, 'g'),
  block: new RegExp(String.raw`ticket\.mjs\s+block\s+${TICKET}([^\n]*)`, 'g'),
  withdraw: new RegExp(String.raw`ticket\.mjs\s+withdraw\s+${TICKET}`, 'g'),
  newTicket: /ticket\.mjs\s+new\s+["']/,
  filed: /^(T-\d{4}) created/m,
  checkout: /git\s+checkout\s+-b\s+["']?([^\s"';]+)/,
  push: /git\s+push\s+(?:-q\s+|--quiet\s+)?(?:-u\s+|--set-upstream\s+)?origin\s+(?:HEAD:)?["']?([^\s"';]+)/g,
  prCreate: /\bpr-create\s+(\S+)\s+(\S+)\s+(\S+)/,
  prFind: /\bpr-find\s+(\S+)\s+(\S+)/,
  prMerge: /\bpr-merge\s+(\S+)\s+(\d+)/,
  branchDelete: /\bbranch-delete\s+\S+\s+(\S+)/,
  bareNumber: /^\s*(\d+)\s*$/,
  sha: /^\s*([0-9a-f]{40})\s*$/,
  api5xx: /API Error: 5\d\d/,
  salvagePush: /pushing (\S+)/g,
  salvagePark: /parking leftovers on (\S+)/g,
};

/** A branch a run pushed. Salvage branches are the runner's parking lot, not the
 *  run's own work, and naming one as "the branch" would report a dead run as if
 *  it had opened something. `HEAD` is what the second and third push of a run
 *  usually says (`git push -q origin HEAD`) and it names nothing. */
const isWorkBranch = (b) => !!b && !b.startsWith('steward/salvage/')
  && !['main', 'dev', 'HEAD'].includes(b);

export function extract(uses) {
  const r = {
    tickets_claimed: [], tickets_done: [], tickets_split: [], tickets_blocked: [],
    tickets_filed: [], branch: null, pr: null, pr_repo: null, pr_url: null,
    merge_sha: null, held: false, branch_deleted: null, tool_calls: uses.length,
    tool_errors: uses.filter((u) => u.result?.is_error).length,
  };
  const add = (list, v) => { if (v && !list.includes(v)) list.push(v); };

  for (const u of uses) {
    const cmd = typeof u.input?.command === 'string' ? u.input.command : '';
    if (!cmd) continue;
    const res = u.result?.text ?? '';

    for (const m of cmd.matchAll(rx.claim)) add(r.tickets_claimed, m[1]);
    for (const m of cmd.matchAll(rx.split)) add(r.tickets_split, m[1]);
    for (const m of cmd.matchAll(rx.withdraw)) add(r.tickets_split, m[1]);
    for (const m of cmd.matchAll(rx.done)) {
      if (!r.tickets_done.some((d) => d.id === m[1])) {
        r.tickets_done.push({ id: m[1], pr: m[2] ? Number(m[2]) : null });
      }
      if (m[2]) r.pr ??= Number(m[2]);
    }
    for (const m of cmd.matchAll(rx.block)) {
      const kind = /--owner/.test(m[2] ?? '') ? 'owner' : 'tech';
      if (!r.tickets_blocked.some((b) => b.id === m[1])) r.tickets_blocked.push({ id: m[1], kind });
    }
    if (rx.newTicket.test(cmd)) { const f = rx.filed.exec(res); if (f) add(r.tickets_filed, f[1]); }

    const co = rx.checkout.exec(cmd);
    if (isWorkBranch(co?.[1])) r.branch = co[1];
    for (const m of cmd.matchAll(rx.push)) if (isWorkBranch(m[1])) r.branch = m[1];

    const pc = rx.prCreate.exec(cmd);
    if (pc) {
      r.pr_repo ??= pc[1];
      if (isWorkBranch(pc[2])) r.branch = pc[2];
      const n = rx.bareNumber.exec(res);
      if (n) r.pr = Number(n[1]);
    }
    const pf = rx.prFind.exec(cmd);
    if (pf && !r.pr) { const n = rx.bareNumber.exec(res); if (n) { r.pr = Number(n[1]); r.pr_repo ??= pf[1]; } }

    const pm = rx.prMerge.exec(cmd);
    if (pm) {
      r.pr_repo ??= pm[1]; r.pr ??= Number(pm[2]);
      const sha = rx.sha.exec(res);
      // A merge CALL is not a merge. #1466's last act was a pr-merge that
      // errored on its own turn ceiling; only the sha it prints is the receipt.
      if (sha && Number(pm[2]) === r.pr) r.merge_sha = sha[1];
    }
    if (/\bhold\b/.test(cmd) && /label|pr-comment|issue-comment/.test(cmd)) r.held = true;

    const bd = rx.branchDelete.exec(cmd);
    if (bd) r.branch_deleted = bd[1];
  }
  if (r.pr && r.pr_repo) r.pr_url = `https://github.com/${r.pr_repo}/pull/${r.pr}`;
  return r;
}

/** How the run ended, in the order that matters: what it achieved beats what it
 *  attempted, and "died" is reserved for a run whose process did not come back. */
export function outcomeOf(x, { status, hasResult, subtype }) {
  if (x.merge_sha) return 'merged';
  if (x.pr && x.held) return 'hold';
  if (x.pr) return 'open';
  if (x.tickets_blocked.length) return 'blocked';
  if (!hasResult || String(subtype ?? '').startsWith('error')) return 'died';
  if (status && status !== 'success') return 'died';
  return 'no-pr';
}

function salvaged(file) {
  if (!file || !existsSync(file)) return [];
  const text = readFileSync(file, 'utf8');
  const out = [];
  for (const m of text.matchAll(rx.salvagePush)) if (!out.includes(m[1])) out.push(m[1]);
  for (const m of text.matchAll(rx.salvagePark)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

/** The whole record for one run. `streams` are read in order; a resumed run has
 *  two, and its work is the union of both. */
export function buildRecord({ streams, salvage, app, slice, slices, runId, runUrl, status }) {
  const files = (streams || []).filter((f) => f && existsSync(f));
  const parts = files.map((f) => collectTools(readEvents(f)));
  const uses = parts.flatMap((p) => p.uses);
  const results = parts.map((p) => p.result).filter(Boolean);
  const last = results[results.length - 1] ?? null;
  const x = extract(uses);
  const anyText = parts.flatMap((p) => p.uses.map((u) => u.result?.text ?? ''))
    .concat(results.map((rr) => String(rr.result || rr.error || '')));

  return {
    v: 1,
    run_id: runId ?? null,
    run_url: runUrl ?? null,
    app: app ?? null,
    slice: slice ? Number(slice) : null,
    slices: slices ? Number(slices) : null,
    status: status ?? null,
    outcome: outcomeOf(x, { status, hasResult: !!last, subtype: last?.subtype }),
    ...x,
    turns: last?.num_turns ?? null,
    cost_usd: last?.total_cost_usd != null ? Number(last.total_cost_usd.toFixed(2)) : null,
    minutes: last?.duration_ms != null ? Number((last.duration_ms / 60000).toFixed(1)) : null,
    result_subtype: last?.subtype ?? null,
    // A second stream file only exists because the first attempt hit a 5xx and
    // the workflow resumed it — that is the retry count, read from the artifacts
    // rather than from a counter nobody would keep in sync.
    resumes: Math.max(0, files.length - 1),
    api_5xx: anyText.some((t) => rx.api5xx.test(t)),
    salvaged_branches: salvaged(salvage),
  };
}

/* ---------------------------------------------------------------- render */

const DOT = { merged: '🟢', open: '🔵', hold: '🟡', blocked: '🟠', died: '🔴', 'no-pr': '⚪' };

/** The journal body's opening. The HTML comment is the machine copy Manager
 *  parses; the table is what a person reads. `--` cannot appear inside an HTML
 *  comment, so any in the JSON is escaped — `JSON.parse` decodes it back. */
export function toMarkdown(rec) {
  const json = JSON.stringify(rec).replace(/--/g, '-\\u002d');
  const tk = rec.tickets_done.map((d) => d.id).join(', ')
    || rec.tickets_claimed.join(', ') || '—';
  const pr = rec.pr_url ? `[${rec.pr_repo}#${rec.pr}](${rec.pr_url})` : (rec.pr ? `#${rec.pr}` : '—');
  const slice = rec.slice && rec.slices > 1 ? ` [${rec.slice}/${rec.slices}]` : '';
  const extra = [
    rec.tickets_split.length ? `split ${rec.tickets_split.join(', ')}` : '',
    rec.tickets_blocked.length ? `blocked ${rec.tickets_blocked.map((b) => `${b.id} (${b.kind})`).join(', ')}` : '',
    rec.tickets_filed.length ? `filed ${rec.tickets_filed.join(', ')}` : '',
    rec.salvaged_branches.length ? `salvaged ${rec.salvaged_branches.join(', ')}` : '',
    rec.resumes ? `${rec.resumes} resume(s) after an API 5xx` : '',
  ].filter(Boolean).join(' · ');

  return `<!-- steward-record: ${json} -->
**${DOT[rec.outcome] ?? '⚪'} ${rec.outcome}** · ${rec.app ?? 'fleet'}${slice}

| ticket | branch | PR | tool calls | turns | min | cost |
|---|---|---|---|---|---|---|
| ${tk} | ${rec.branch ? `\`${rec.branch}\`` : '—'} | ${pr} | ${rec.tool_calls} | ${rec.turns ?? '—'} | ${rec.minutes ?? '—'} | ${rec.cost_usd != null ? `$${rec.cost_usd.toFixed(2)}` : '—'} |
${extra ? `\n${extra}\n` : ''}`;
}

/* ------------------------------------------------------------- self-test */

const FIXTURES = new URL('./fixtures/', import.meta.url).pathname;

function selfTest() {
  const cases = [
    { file: 'improve-merged.jsonl', want: { outcome: 'merged', pr: 705, branch: 'steward/t-0531-census-1840-210-215-219',
      tickets_claimed: ['T-0531'], done: 'T-0531', merged: true, tool_calls: 7, branch_deleted: 'steward/t-0531-census-1840-210-215-219' } },
    { file: 'improve-hold.jsonl', want: { outcome: 'hold', pr: 693, branch: 'steward/t-0533-census-1840-sheets-225-228',
      tickets_claimed: ['T-0533'], done: null, merged: false, tool_calls: 5, branch_deleted: null } },
    { file: 'improve-died.jsonl', want: { outcome: 'died', pr: null, branch: 'steward/t-0526-census-1840-sheets-216-224',
      tickets_claimed: ['T-0526'], done: null, merged: false, tool_calls: 3, branch_deleted: null } },
  ];
  let bad = 0;
  const ok = (what, cond, detail = '') => {
    console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${what}${detail ? ` — ${detail}` : ''}`);
    if (!cond) bad += 1;
  };
  for (const c of cases) {
    const rec = buildRecord({ streams: [`${FIXTURES}${c.file}`], app: 'custom', slice: 2, slices: 5,
      runId: '1', runUrl: 'https://example.invalid/1', status: c.want.outcome === 'died' ? 'failure' : 'success' });
    ok(`${c.file}: outcome`, rec.outcome === c.want.outcome, rec.outcome);
    ok(`${c.file}: PR`, rec.pr === c.want.pr, String(rec.pr));
    ok(`${c.file}: branch`, rec.branch === c.want.branch, String(rec.branch));
    ok(`${c.file}: claimed`, JSON.stringify(rec.tickets_claimed) === JSON.stringify(c.want.tickets_claimed),
      rec.tickets_claimed.join(','));
    ok(`${c.file}: closed`, (rec.tickets_done[0]?.id ?? null) === c.want.done, String(rec.tickets_done[0]?.id ?? null));
    ok(`${c.file}: merge sha ${c.want.merged ? 'recorded' : 'absent'}`, !!rec.merge_sha === c.want.merged, String(rec.merge_sha));
    ok(`${c.file}: tool calls`, rec.tool_calls === c.want.tool_calls, String(rec.tool_calls));
    ok(`${c.file}: deleted branch`, (rec.branch_deleted ?? null) === c.want.branch_deleted, String(rec.branch_deleted));
    const md = toMarkdown(rec);
    ok(`${c.file}: the marker round-trips`, (() => {
      const m = /<!-- steward-record: ([\s\S]*?) -->/.exec(md);
      try { return JSON.parse(m[1]).outcome === c.want.outcome; } catch { return false; }
    })());
    ok(`${c.file}: the comment cannot close early`, !/--(?!>)/.test(md.split('\n')[0].slice(21, -4)));
    ok(`${c.file}: no model identifier`, !/claude-[a-z0-9-]*\d/i.test(md));
  }
  // A stream that never started still yields a usable record rather than throwing.
  const empty = buildRecord({ streams: ['/nonexistent/stream.jsonl'], status: 'failure' });
  ok('a missing stream records "died" rather than throwing', empty.outcome === 'died' && empty.tool_calls === 0);

  console.log(bad ? `\nrun-record self-test: ${bad} failure(s)` : '\nrun-record self-test OK');
  process.exit(bad ? 1 : 0);
}

/* ------------------------------------------------------------------ main */

const argv = process.argv.slice(2);
const arg = (name) => { const i = argv.indexOf(`--${name}`); return i < 0 ? null : argv[i + 1] ?? null; };

if (argv.includes('--self-test')) selfTest();
else {
  const rec = buildRecord({
    streams: [arg('stream'), arg('resume')],
    salvage: arg('salvage'),
    app: arg('app'), slice: arg('slice'), slices: arg('slices'),
    runId: arg('run-id'), runUrl: arg('run-url'), status: arg('status'),
  });
  const md = toMarkdown(rec);
  if (arg('json')) writeFileSync(arg('json'), `${JSON.stringify(rec, null, 2)}\n`);
  if (arg('md')) writeFileSync(arg('md'), md);
  if (!arg('json') && !arg('md')) process.stdout.write(`${md}\n`);
  else console.log(`record: ${rec.outcome} · ${rec.tickets_claimed.join(',') || '(no ticket)'}`
    + `${rec.pr ? ` · PR #${rec.pr}` : ''} · ${rec.tool_calls} tool calls`);
}
