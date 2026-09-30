// Fill independent app/lane slots. Run-list failures abort; never guess capacity.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { appLanes, validateLane, freeSlots, dispatchInputs } from './lanes.mjs';
import { isDueAt } from './schedule.mjs';
const repo = 'kevinrhaas/polecat-platform';
const lanes = appLanes(JSON.parse(readFileSync(new URL('./focus.json', import.meta.url))));
const due = lanes.filter(l => isDueAt(l.config, new Date()));
// Validate the whole plan before spending anything.
for(const lane of due) validateLane(lane);
const runs = [];
if(due.length){
  // Query each live status separately and paginate, so a busy fleet cannot hide
  // an occupied slot behind recent completed runs or a fixed 60-run limit.
  for(const status of ['queued', 'in_progress', 'waiting', 'pending', 'requested']){
    const pages = JSON.parse(execFileSync('gh', ['api', '--paginate', '--slurp',
      `repos/${repo}/actions/workflows/steward-improve.yml/runs?status=${status}&per_page=100`], { encoding: 'utf8' }));
    for(const page of pages){
      if(!Array.isArray(page.workflow_runs)) throw new Error('Invalid workflow run list');
      runs.push(...page.workflow_runs);
    }
  }
}
for(const lane of due){
  for(const slot of freeSlots(lane, runs)){
    const args = ['workflow', 'run', 'steward-improve.yml', '-R', repo];
    for(const [key, value] of Object.entries(dispatchInputs(lane, slot))) args.push('-f', `${key}=${value}`);
    execFileSync('gh', args, { stdio: 'inherit' });
    console.log(`Dispatched ${lane.app} / ${lane.id || 'default'} slot ${slot}`);
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
}
