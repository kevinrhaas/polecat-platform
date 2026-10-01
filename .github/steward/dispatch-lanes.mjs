import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { appLanes, busySlots, processorOf } from './lanes.mjs';
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
const runs = [...byId.values()];
const now = new Date();
let count = 0;
for (const lane of lanes) {
  if (!isDueAt(lane.config, now)) continue;
  const n = slicesOf(lane.config), busy = busySlots(runs, lane);
  let free = n - busy.size;
  const settings = processorOf(lane.config);
  // Distinct queue positions across this app's enabled lanes reduce collisions;
  // repository ticket claims remain the authority, including during resizing.
  const siblings = lanes.filter(l => l.app === lane.app && isDueAt(l.config, now));
  const offset = siblings.slice(0, siblings.indexOf(lane)).reduce((v, l) => v + slicesOf(l.config), 0);
  const total = siblings.reduce((v, l) => v + slicesOf(l.config), 0);
  for (let k = 1; k <= n && free > 0; k++) {
    if (busy.has(k)) continue;
    const inputs = { app: lane.app, lane: lane.id, slice: k, slices: n,
      ...settings, max_turns: lane.config.max_turns || '', queue_position: `${offset + k}/${total}` };
    const args = ['workflow', 'run', 'steward-improve.yml', '-R', repo];
    for (const [key, value] of Object.entries(inputs)) args.push('-f', `${key}=${value}`);
    gh(args);
    console.log(`Dispatched ${lane.app} / ${lane.id || 'default'} ${k}/${n}: ${settings.processor} ${settings.model} ${settings.effort || 'default effort'}`);
    free--; count++;
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
}
console.log(`Dispatched ${count} app run(s).`);
