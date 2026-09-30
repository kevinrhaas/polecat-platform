import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { appLanes, busySlots, processorOf } from './lanes.mjs';
import { isDueAt, slicesOf } from './schedule.mjs';

const repo = process.env.GITHUB_REPOSITORY || 'kevinrhaas/polecat-platform';
const gh = args => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
const roster = JSON.parse(readFileSync(new URL('./focus.json', import.meta.url)));
const lanes = appLanes(roster);
// Query every non-completed state and paginate: recent completed runs cannot
// hide long-running slots. Fail closed if GitHub cannot establish occupancy.
const runs = [];
for (const status of ['in_progress', 'queued', 'waiting', 'pending', 'requested']) {
  const pages = JSON.parse(gh(['api', '--paginate', '--slurp',
    `repos/${repo}/actions/workflows/steward-improve.yml/runs?status=${status}&per_page=100`]));
  for (const page of pages) for (const r of page.workflow_runs) runs.push({ status: r.status, displayTitle: r.display_title });
}
let count = 0;
for (const lane of lanes) {
  if (!isDueAt(lane.config, new Date())) continue;
  const n = slicesOf(lane.config), busy = busySlots(runs, lane);
  let free = n - busy.size;
  const settings = processorOf(lane.config);
  // Distinct queue positions across this app's enabled lanes reduce collisions;
  // repository ticket claims remain the authority, including during resizing.
  const siblings = lanes.filter(l => l.app === lane.app && l.config.enabled);
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
