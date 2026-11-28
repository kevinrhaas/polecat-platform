// BATCH MERGE — the steward janitor's `batch` job (Kevin, 2026-11-27: "Can you
// improve the steward janitor loop to do this automatically periodically?").
//
// WHY. With five chicago slices running, `dev` moves every few minutes and each
// landing re-dirties every other open loop PR. Each is then lapped, re-gated (~80
// min on the shared runner pool) and dirtied again before its gate ends, so a
// queue of finished work never drains. Twice on 2026-11-27 a thread paused the
// lane by hand and batched them: #2399 put six loop PRs on one gate, merged it
// with a MERGE commit (c895b7776), GitHub marked all six merged, and the lane was
// restarted. This automates that loop; the git and the regeneration live in the
// app repo, in kevinrhaas/chicago `.github/steward/pr-batch.sh`, beside the tools.
//
// EACH JANITOR RUN (hourly, roster job `janitor`) makes ONE of these moves:
//   * an open batch PR (branch steward/batch-*):
//       clean            → merge it with a MERGE commit, give back its members' lap
//                          locks, lift the lane hold, kick the scheduler
//       gate red         → close it, label its members `no-batch` (they go back to
//                          their own lap and are not batched again), lift the hold
//       open too long    → the same, as timed out (BATCH_MAX_HOURS)
//       otherwise        → wait, and keep the hold for it
//   * no open batch: close any member a batch landed that GitHub left open with
//     nothing left to merge, lift a hold nothing owns, then pick the members of the
//     next batch: open loop PRs (steward/*, not draft, no `hold`/`no-batch`) whose
//     own work went green. At BATCH_MIN of them it answers `build`, and the workflow
//     holds the lane, clones the app and runs pr-batch.sh.
//
// A HAND BATCH IS NEVER RACED: while any other open PR is titled "Batch…" (a
// thread doing this by hand) the job does nothing at all.
//
// THE HOLD is the repository variable STEWARD_HOLD_<APP> ("<until ISO> <why>"),
// read by dispatch-lanes.mjs exactly as it reads STEWARD_HOLD_CLAUDE: until then it
// starts no slice for that app, and once the time passes it deletes the variable
// and the lane fills again. So a hold nothing lifts ends by itself (BATCH_HOLD_HOURS
// at most, re-armed each run while a batch is open, never past BATCH_MAX_HOURS).
// Slices already running when the hold starts carry on; the PR lap keeps the open
// batch current with `dev` like any other PR.
//
//   node batch-merge.mjs tick            one move; writes action=… members=… to $GITHUB_OUTPUT
//   node batch-merge.mjs hold "<why>"    set the hold before a build
//   node batch-merge.mjs settle <out>    after pr-batch.sh: lift the hold if it opened nothing
//   node batch-merge.mjs --self-test
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { appHoldVar, readHold } from './usage-hold.mjs';

export const BATCH_PREFIX = 'steward/batch-';
export const MEMBERS_MARK = /<!--\s*batch-members:\s*([\d,\s]*)-->/;
export const holdVar = appHoldVar;

const env = process.env;
const APP = env.BATCH_APP || 'chicago';
const OWNER = env.FLEET_OWNER || 'kevinrhaas';
const APP_REPO = `${OWNER}/${APP}`;
const BASE = env.BATCH_BASE || 'dev';
const HOME = env.GITHUB_REPOSITORY || `${OWNER}/polecat-platform`;
const MIN = Number(env.BATCH_MIN || 3);
const MAX = Number(env.BATCH_MAX || 8);
const HOLD_H = Number(env.BATCH_HOLD_HOURS || 3);
const MAX_H = Number(env.BATCH_MAX_HOURS || 6);
const HOUR = 3600 * 1000;

// ---- pure decisions (tested below) -------------------------------------------
export const isBatch = pr => (pr.head?.ref || '').startsWith(BATCH_PREFIX);
export const membersOf = body => ((MEMBERS_MARK.exec(body || '') || [])[1] || '')
  .split(/[\s,]+/).filter(Boolean).map(Number).filter(Number.isInteger);
const labelled = (pr, name) => (pr.labels || []).some(l => (l.name || l) === name);

/** A hand batch: an open PR titled "Batch…" that this job did not open. */
export const handBatch = prs => prs.find(p => !isBatch(p) && /^batch\b/i.test(p.title || ''));

/** The loop PRs a batch may take, before their gates are read. */
export const candidates = prs => prs
  .filter(p => !p.draft && (p.head?.ref || '').startsWith('steward/') && !isBatch(p)
            && !labelled(p, 'hold') && !labelled(p, 'no-batch'))
  .sort((a, b) => a.number - b.number);

/**
 * Did this PR's own work go green? Walk back from the head through the dev merges
 * the lap and the run pushed after it (two-parent commits, first parent = the
 * branch), at most `depth` commits, to the first commit a `gate` ran on.
 * `verdictOf(sha)` → 'success' | 'failure' | 'pending' | null (never ran);
 * `commitOf(sha)` → { parents: [sha…] }.
 */
export function ownWorkGreen(head, verdictOf, commitOf, depth = 5) {
  let sha = head;
  for (let i = 0; i < depth && sha; i++) {
    const v = verdictOf(sha);
    if (v === 'success') return true;
    if (v === 'failure') return false;
    const c = commitOf(sha);
    if (!c || (c.parents || []).length !== 2) return false;   // the PR's own commit, never gated green
    sha = c.parents[0];
  }
  return false;
}

/** The members to label `no-batch` after a build: a conflicting one, or all of them when the build failed. */
export function settleLabels(out, members = '') {
  if (/^failed=/m.test(out) || !/^members=/m.test(out)) return String(members).split(/[\s,]+/).filter(Boolean).map(Number);
  const dropped = /^dropped=(.*)$/m.exec(out)?.[1] || '';
  return [...dropped.matchAll(/(\d+)\(conflict\)/g)].map(m => Number(m[1]));
}

/** What to do with an open batch PR. */
export function judgeBatch({ mergeable, verdict, createdAt, now }) {
  if (mergeable === 'clean') return 'merge';
  if (verdict === 'failure') return 'red';
  if (now - Date.parse(createdAt) > MAX_H * HOUR) return 'timeout';
  return 'wait';
}

// ---- GitHub -------------------------------------------------------------------
const gh = (args, input) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  input, stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
const api = (path, ...rest) => JSON.parse(gh(['api', path, ...rest]) || 'null');
const apiTry = (...a) => { try { return api(...a); } catch { return null; } };
const listOpen = () => JSON.parse(gh(['api', '--paginate', '--slurp',
  `repos/${APP_REPO}/pulls?state=open&base=${BASE}&per_page=100`])).flat();

function gateVerdict(sha) {
  const runs = (apiTry(`repos/${APP_REPO}/commits/${sha}/check-runs?per_page=100`)?.check_runs || [])
    .filter(r => r.name === 'gate').sort((a, b) => String(a.started_at).localeCompare(String(b.started_at)));
  const last = runs.at(-1);
  if (!last) return null;
  if (last.status !== 'completed') return 'pending';
  if (last.conclusion === 'success') return 'success';
  if (['failure', 'timed_out'].includes(last.conclusion)) return 'failure';
  return 'pending';   // cancelled/neutral: superseded, not a verdict
}
const commitOf = sha => apiTry(`repos/${APP_REPO}/commits/${sha}`)?.parents?.map(p => p.sha)
  .reduce((c, p) => (c.parents.push(p), c), { parents: [] }) || null;

const comment = (n, body) => gh(['api', '-X', 'POST', `repos/${APP_REPO}/issues/${n}/comments`, '--input', '-'],
  JSON.stringify({ body: `${body}\n\n---\n_Steward janitor (batch merge)_` }));
const dropLock = n => { try { gh(['api', '-X', 'DELETE', `repos/${APP_REPO}/git/refs/heads/lap/pr-${n}`]); } catch { /* not held */ } };

function setHold(why, until) {
  const name = holdVar(APP), value = `${until.toISOString()} ${why}`;
  try { gh(['api', '-X', 'PATCH', `repos/${HOME}/actions/variables/${name}`, '-f', `name=${name}`, '-f', `value=${value}`]); }
  catch { gh(['api', '-X', 'POST', `repos/${HOME}/actions/variables`, '-f', `name=${name}`, '-f', `value=${value}`]); }
  console.log(`hold: ${name} = ${value}`);
}
function readAppHold() {
  try { return readHold(gh(['api', `repos/${HOME}/actions/variables/${holdVar(APP)}`, '--jq', '.value']).trim()); }
  catch { return null; }
}
function liftHold(why) {
  try { gh(['api', '-X', 'DELETE', `repos/${HOME}/actions/variables/${holdVar(APP)}`]); }
  catch { return false; }
  console.log(`hold lifted (${why}); kicking the scheduler so the ${APP} lane fills now`);
  try { gh(['workflow', 'run', 'steward-focus.yml', '-R', HOME]); } catch { console.log('::warning::could not dispatch steward-focus; the next cron tick refills'); }
  return true;
}
function output(kv) {
  for (const [k, v] of Object.entries(kv)) {
    console.log(`${k}=${v}`);
    if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `${k}=${v}\n`);
  }
}

// ---- the tick ---------------------------------------------------------------------
function tick(now = new Date()) {
  const prs = listOpen();
  const hand = handBatch(prs);
  if (hand) {
    console.log(`#${hand.number} "${hand.title}" is a batch being landed by hand — not batching alongside it`);
    return output({ action: 'none', reason: `hand batch #${hand.number} open` });
  }

  const open = prs.filter(isBatch).sort((a, b) => a.number - b.number);
  if (open.length) {
    const b = open[0];
    const full = api(`repos/${APP_REPO}/pulls/${b.number}`);
    const members = membersOf(full.body);
    const verdict = gateVerdict(full.head.sha);
    const move = judgeBatch({ mergeable: full.mergeable_state, verdict, createdAt: full.created_at, now });
    console.log(`batch #${b.number} (${members.length} members: ${members.map(n => '#' + n).join(' ')}): ` +
      `mergeable=${full.mergeable_state} gate=${verdict || 'not run'} → ${move}`);
    if (move === 'merge') {
      try {
        gh(['api', '-X', 'PUT', `repos/${APP_REPO}/pulls/${b.number}/merge`, '-f', 'merge_method=merge', '-f', `sha=${full.head.sha}`]);
      } catch (e) {
        console.log(`merge refused (${String(e.stderr || e.message).trim().split('\n').pop()}); the next run re-reads it`);
        return output({ action: 'wait', batch: b.number });
      }
      members.forEach(dropLock);
      liftHold(`batch #${b.number} merged`);
      return output({ action: 'merged', batch: b.number, members: members.join(',') });
    }
    if (move === 'red' || move === 'timeout') {
      const why = move === 'red' ? 'its gate went red' : `it was still open after ${MAX_H} h`;
      comment(b.number, `Closing this batch: ${why}. Its members go back to their own laps and are labelled \`no-batch\`, so the next batch does not take them again; take the label off a member to let it back in.`);
      gh(['api', '-X', 'PATCH', `repos/${APP_REPO}/pulls/${b.number}`, '-f', 'state=closed']);
      try { gh(['api', '-X', 'DELETE', `repos/${APP_REPO}/git/refs/heads/${full.head.ref}`]); } catch { /* gone */ }
      for (const n of members) {
        try { gh(['api', '-X', 'POST', `repos/${APP_REPO}/issues/${n}/labels`, '--input', '-'], JSON.stringify({ labels: ['no-batch'] })); } catch { /* closed meanwhile */ }
        dropLock(n);
      }
      liftHold(`batch #${b.number} closed, ${why}`);
      return output({ action: move, batch: b.number });
    }
    const until = new Date(Math.min(now.getTime() + HOLD_H * HOUR, Date.parse(full.created_at) + MAX_H * HOUR));
    setHold(`batch #${b.number} landing (${members.length} PRs)`, until);
    return output({ action: 'wait', batch: b.number });
  }

  // No open batch. First, tidy up after the last one that landed.
  const recent = JSON.parse(gh(['api', `repos/${APP_REPO}/pulls?state=closed&base=${BASE}&sort=updated&direction=desc&per_page=30`]))
    .filter(p => isBatch(p) && p.merged_at && now - Date.parse(p.merged_at) < 48 * HOUR);
  const openNums = new Set(prs.map(p => p.number));
  for (const b of recent) {
    for (const n of membersOf(b.body).filter(n => openNums.has(n))) {
      const pr = prs.find(p => p.number === n);
      const cmp = apiTry(`repos/${APP_REPO}/compare/${BASE}...${pr.head.sha}`);
      if (cmp && (cmp.files || []).length === 0) {
        comment(n, `This landed in \`${BASE}\` with batch #${b.number}; the commits it gained since (a lap's merge of \`${BASE}\`) change nothing, so it is closed as merged by the batch.`);
        gh(['api', '-X', 'PATCH', `repos/${APP_REPO}/pulls/${n}`, '-f', 'state=closed']);
        dropLock(n);
        console.log(`#${n}: landed by batch #${b.number}, nothing left to merge — closed`);
        openNums.delete(n);
      }
    }
  }
  if (readAppHold()) liftHold('no batch is open');

  const pool = candidates(prs.filter(p => openNums.has(p.number)));
  const members = [];
  for (const p of pool) {
    if (members.length >= MAX) break;
    const green = ownWorkGreen(p.head.sha, gateVerdict, commitOf);
    console.log(`#${p.number} ${p.head.ref}: ${green ? 'its own work is green — in' : 'not green — left for its lap'}`);
    if (green) members.push(p.number);
  }
  if (members.length < MIN) {
    console.log(`${members.length} batchable loop PR(s); a batch needs ${MIN}`);
    return output({ action: 'none', members: members.join(','), reason: `${members.length} batchable` });
  }
  return output({ action: 'build', members: members.join(',') });
}

// ---- entry ------------------------------------------------------------------------
const [cmd, arg] = process.argv.slice(2);
if (cmd === 'tick') tick();
else if (cmd === 'hold') setHold(arg || 'batch building', new Date(Date.now() + HOLD_H * HOUR));
else if (cmd === 'settle') {
  let out = '';
  try { out = readFileSync(arg, 'utf8'); } catch { /* the build never wrote it */ }
  const pr = /^pr=(\d+)$/m.exec(out)?.[1];
  // NO RETRY LOOP. The janitor runs hourly, and a member that cannot join (a real
  // conflict with another member) or a build that fails would be picked again next
  // hour, forever. So each is labelled `no-batch` and goes back to its own lap, as
  // before this job existed; take the label off to let it back in.
  const label = n => { try { gh(['api', '-X', 'POST', `repos/${APP_REPO}/issues/${n}/labels`, '--input', '-'], JSON.stringify({ labels: ['no-batch'] })); console.log(`#${n}: labelled no-batch`); } catch { /* closed meanwhile */ } };
  for (const n of settleLabels(out, env.BATCH_PRS)) label(n);
  if (pr) console.log(`batch #${pr} opened; the hold stays until it lands`);
  else liftHold('the build opened no batch');
} else if (cmd === '--self-test') {
  const assert = (await import('node:assert/strict')).default;
  const pr = (number, ref, extra = {}) => ({ number, head: { ref, sha: 's' + number }, labels: [], draft: false, title: 'T', ...extra });
  assert.equal(holdVar('chicago'), 'STEWARD_HOLD_CHICAGO');
  assert.deepEqual(membersOf('x\n<!-- batch-members: 2401,2402, 2404 -->\ny'), [2401, 2402, 2404]);
  assert.deepEqual(membersOf('no marker'), []);
  const prs = [pr(5, 'steward/t1-a'), pr(3, 'steward/t2-b'), pr(4, 'claude/project-thread-x'),
    pr(6, 'steward/t3-c', { draft: true }), pr(7, 'steward/t4-d', { labels: [{ name: 'hold' }] }),
    pr(8, 'steward/t5-e', { labels: [{ name: 'no-batch' }] }), pr(9, 'steward/batch-20261128-0100')];
  assert.deepEqual(candidates(prs).map(p => p.number), [3, 5], 'loop PRs only, oldest first');
  assert.equal(handBatch(prs), undefined);
  assert.equal(handBatch([...prs, pr(10, 'claude/project-thread-y', { title: 'Batch: six loop PRs' })]).number, 10);
  assert.equal(handBatch([pr(9, 'steward/batch-1', { title: 'Batch: 3 loop PRs' })]), undefined, 'our own batch is not a hand batch');
  // own work: green head; green under a lap merge; red; a never-gated own commit
  const v = { h1: 'success', p2: 'success', h3: 'failure', h5: null, m4: 'pending' };
  const c = { m4: { parents: ['p2', 'dev'] }, h5: { parents: ['x'] }, m6: { parents: ['m4', 'dev'] } };
  assert.equal(ownWorkGreen('h1', s => v[s], s => c[s]), true);
  assert.equal(ownWorkGreen('m4', s => v[s], s => c[s]), true, 'a lap merge on green work');
  assert.equal(ownWorkGreen('m6', s => v[s], s => c[s]), true, 'two merges deep');
  assert.equal(ownWorkGreen('h3', s => v[s], s => c[s]), false);
  assert.equal(ownWorkGreen('h5', s => v[s], s => c[s]), false, 'its own commit was never gated green');
  assert.equal(ownWorkGreen('m6', s => v[s], s => c[s], 1), false, 'depth bounds the walk');
  const now = new Date('2026-11-28T06:00:00Z');
  assert.equal(judgeBatch({ mergeable: 'clean', verdict: 'success', createdAt: '2026-11-28T05:00:00Z', now }), 'merge');
  assert.equal(judgeBatch({ mergeable: 'blocked', verdict: 'failure', createdAt: '2026-11-28T05:00:00Z', now }), 'red');
  assert.equal(judgeBatch({ mergeable: 'blocked', verdict: 'pending', createdAt: '2026-11-28T05:00:00Z', now }), 'wait');
  assert.equal(judgeBatch({ mergeable: 'dirty', verdict: 'pending', createdAt: '2026-11-27T23:00:00Z', now }), 'timeout');
  assert.deepEqual(settleLabels('members=1,2\ndropped=3(conflict),4(locked)\npr=9\n', '1 2 3 4'), [3], 'only a conflicting member');
  assert.deepEqual(settleLabels('members=1,2\ndropped=\nfailed=regeneration step failed\n', '1,2'), [1, 2], 'a failed build labels every member');
  assert.deepEqual(settleLabels('', '1,2'), [1, 2], 'a build that wrote nothing failed');
  assert.deepEqual(settleLabels('members=1\ndropped=2(conflict)\n', '1,2'), [2], 'too few: the conflicting one');
  console.log('batch-merge self-test: ok');
} else {
  console.error('usage: batch-merge.mjs tick | hold "<why>" | settle <pr-batch out file> | --self-test');
  process.exit(2);
}
