import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { appLanes, busySlots, processorOf, queueGate, queueLimits } from './lanes.mjs';
import { isDueAt, slicesOf } from './schedule.mjs';

const repo = process.env.GITHUB_REPOSITORY || 'kevinrhaas/polecat-platform';
// maxBuffer: each run object carries its full head-commit message, so 100 runs
// is over 1 MB, which is execFileSync's default cap. Overflowing it throws
// ENOBUFS and the scheduler dispatches nothing (2026-10-01, 17:30-18:30Z).
const gh = args => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] });
const roster = JSON.parse(readFileSync(new URL('./focus.json', import.meta.url)));
const lanes = appLanes(roster);
// Occupancy comes from TWO listings, unioned by run id, because neither is
// enough alone.
//
// 1. Status-FILTERED, paginated: every non-completed state. This is what keeps
//    a long-pending or long-running slot visible however many completed runs
//    have been created since.
// 2. UNFILTERED, the newest page: the filtered listing LAGS. A run that has
//    just changed state (pending -> in_progress as the run ahead of it in its
//    slice group finishes) shows up under neither filter for a while. Measured
//    2026-10-01 on chicago x5: every dispatch that duplicated a busy slice
//    landed within seconds of that slice's pending run being promoted (2585 at
//    16:19:01 vs 2584 promoted 16:18:55; 2586 at 16:20:16 vs 2579 at 16:20:11;
//    2588 at 17:21:32 vs 2586 at 17:21:27). The duplicate then sat pending
//    behind the busy slice, and when THAT slice finished its kick raced the
//    duplicate's own promotion and made another, so one miss kept three
//    slices permanently carrying a stuck pending run. The unfiltered listing
//    reports each run's current status, so a run caught mid-transition is
//    still counted as occupying its slot.
//
// Fail closed if GitHub cannot establish occupancy.
const byId = new Map();
const add = page => { for (const r of page.workflow_runs) byId.set(r.id, { status: r.status, displayTitle: r.display_title }); };
for (const status of ['in_progress', 'queued', 'waiting', 'pending', 'requested']) {
  const pages = JSON.parse(gh(['api', '--paginate', '--slurp',
    `repos/${repo}/actions/workflows/steward-improve.yml/runs?status=${status}&per_page=100`]));
  for (const page of pages) add(page);
}
// 30 newest is ample: this listing only has to catch runs mid-transition.
add(JSON.parse(gh(['api', `repos/${repo}/actions/workflows/steward-improve.yml/runs?per_page=30`])));
// A FREED RUN is the steward-improve run whose last step kicked this tick
// (refill-kick.sh passes its id as `freed_run`). It is still `in_progress`
// while it kicks and through its post-job cleanup, so it would hold its slot
// and the refill would wait for a cron tick. T-2153 measured that happen to
// 37807547340: occupancy read at 18:47:47Z, job finished at 18:47:53Z, zero
// dispatched. The run has finished its work, so its slot is free. Only that
// one run is set aside; any other run in the slot still holds it.
const freed = process.env.FREED_RUN || '';
if (/^\d+$/.test(freed) && byId.delete(Number(freed))) console.log(`Run ${freed} kicked this tick, so its slot is free.`);
const runs = [...byId.values()];
const now = new Date();

// PR-queue backpressure (lanes.mjs § queueGate), read once per app. The count
// is of another repository's pull requests, which the built-in token cannot
// see, so it reads with PR_TOKEN (STEWARD_PAT) when the workflow passes one.
// The paused state lives in a repository variable on THIS repo,
// STEWARD_PAUSED_<APP>, so it survives between ticks and is visible in
// Settings > Variables: present = paused (its value says since when and why),
// absent = running. Every failure here is a warning and fails OPEN.
const owner = process.env.FLEET_OWNER || 'kevinrhaas';
const asPat = args => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GH_TOKEN: process.env.PR_TOKEN || process.env.GH_TOKEN } });
const pausedVar = app => 'STEWARD_PAUSED_' + app.toUpperCase().replace(/[^A-Z0-9]/g, '_');
const queues = new Map();
function queueOf(app) {
  if (queues.has(app)) return queues.get(app);
  const q = { open: null, resumable: 0, wasPaused: false, used: 0 };
  try {
    const prs = JSON.parse(asPat(['api', '--paginate', '--slurp', `repos/${owner}/${app}/pulls?state=open&per_page=100`])).flat();
    const live = prs.filter(p => !p.draft && !(p.labels || []).some(l => l.name === 'hold'));
    q.open = live.length;
    // A resume PR touched in the last half hour is skipped: a run or the lap
    // just pushed to it, so its CI is most likely still running, and a
    // finish-only slice sent now would only sit and watch it. Without this a
    // paused lane re-sends a slice at the same PR every time one finishes.
    const cool = now - 30 * 60 * 1000;
    q.resumable = live.filter(p => (p.labels || []).some(l => l.name === 'resume')
      && !(Date.parse(p.updated_at) > cool)).length;
  } catch (e) { console.log(`::warning::${app}: could not count open PRs, so the queue limit is skipped this tick`); }
  try { asPat(['api', `repos/${repo}/actions/variables/${pausedVar(app)}`]); q.wasPaused = true; } catch { /* 404 = running */ }
  queues.set(app, q);
  return q;
}
function recordPause(app, q, gate, limits) {
  if (q.open === null || gate.paused === q.wasPaused) return;
  const name = pausedVar(app);
  try {
    if (gate.paused) {
      const value = `${now.toISOString()} paused at ${q.open} open PRs; restarts at ${limits.resumeAt}`;
      asPat(['api', '--method', 'POST', `repos/${repo}/actions/variables`, '-f', `name=${name}`, '-f', `value=${value}`]);
      console.log(`::notice::${app} lane PAUSED: ${q.open} open PRs (pauses at ${limits.pauseAt}). Only finish-only slices run until it is down to ${limits.resumeAt}.`);
    } else {
      asPat(['api', '--method', 'DELETE', `repos/${repo}/actions/variables/${name}`]);
      console.log(`::notice::${app} lane RESTARTED: ${q.open} open PRs (restarts at ${limits.resumeAt}).`);
    }
    q.wasPaused = gate.paused;
  } catch (e) { console.log(`::warning::${app}: could not record the ${gate.paused ? 'pause' : 'restart'} in ${name}`); }
}

let count = 0;
for (const lane of lanes) {
  if (!isDueAt(lane.config, now)) continue;
  const n = slicesOf(lane.config), busy = busySlots(runs, lane);
  let free = n - busy.size;
  const limits = queueLimits(lane.config);
  let finishOnly = false;
  if (limits) {
    const q = queueOf(lane.app);
    const gate = queueGate(lane.config, { ...q, busy: busy.size });
    recordPause(lane.app, q, gate, limits);
    // `used` carries what earlier lanes of the same app already started this
    // tick, so sibling lanes share one budget instead of each spending it.
    const cap = Math.max(0, gate.cap - q.used);
    console.log(`${lane.app} / ${lane.id || 'default'}: ${gate.why}${q.used ? ` (${q.used} already started this tick)` : ''}`);
    free = Math.min(free, cap);
    finishOnly = gate.finishOnly;
    q.used += Math.max(0, free);
  }
  const settings = processorOf(lane.config);
  // Distinct queue positions across this app's enabled lanes reduce collisions;
  // repository ticket claims remain the authority, including during resizing.
  const siblings = lanes.filter(l => l.app === lane.app && isDueAt(l.config, now));
  const offset = siblings.slice(0, siblings.indexOf(lane)).reduce((v, l) => v + slicesOf(l.config), 0);
  const total = siblings.reduce((v, l) => v + slicesOf(l.config), 0);
  for (let k = 1; k <= n && free > 0; k++) {
    if (busy.has(k)) continue;
    const inputs = { app: lane.app, lane: lane.id, slice: k, slices: n,
      ...settings, max_turns: lane.config.max_turns || '', queue_position: `${offset + k}/${total}`,
      ...(finishOnly ? { finish_only: '1' } : {}) };
    const args = ['workflow', 'run', 'steward-improve.yml', '-R', repo];
    for (const [key, value] of Object.entries(inputs)) args.push('-f', `${key}=${value}`);
    gh(args);
    console.log(`Dispatched ${lane.app} / ${lane.id || 'default'} ${k}/${n}: ${settings.processor} ${settings.model} ${settings.effort || 'default effort'}${finishOnly ? ' (finish-only)' : ''}`);
    free--; count++;
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
}
console.log(`Dispatched ${count} app run(s).`);
