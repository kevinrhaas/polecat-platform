import { execFileSync } from 'node:child_process';
import { writeFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const repo = 'kevinrhaas/polecat-steward';
export function findWorker(runs, request) {
  return runs.find(r => r.event === 'workflow_dispatch' && r.head_branch === 'main' && r.display_title.startsWith(request + ' — '));
}
export async function runWorker({ gh, sleep, now = Date.now, env = process.env, report }) {
  const request = `${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`;
  if (!/^\d+-\d+$/.test(request)) throw new Error('Invalid parent run identity');
  const inputs = JSON.parse(env.WORKER_INPUTS);
  inputs.request_id = request;
  const list = () => JSON.parse(gh(['api',`repos/${repo}/actions/workflows/steward-improve.yml/runs?event=workflow_dispatch&per_page=100`])).workflow_runs;
  // Reattach on a process retry; never create a second worker for one request.
  let worker = findWorker(list(), request);
  if (!worker) gh(['api', '--method', 'POST', `repos/${repo}/actions/workflows/steward-improve.yml/dispatches`, '--input', '-'], JSON.stringify({ ref: 'main', inputs }));
  const deadline = now() + 170 * 60_000;
  let discoveryDeadline = now() + 5 * 60_000;
  let errors = 0;
  while (now() < deadline) {
    try {
      worker = worker ? JSON.parse(gh(['api',`repos/${repo}/actions/runs/${worker.id}`])) : findWorker(list(), request);
      errors = 0;
    } catch (e) {
      if (++errors >= 5) throw new Error('Cannot read private worker status; inspect private Actions before retrying');
      await sleep(30_000); continue;
    }
    if (worker) {
      report(worker);
      if (worker.status === 'completed') {
        if (worker.conclusion !== 'success') throw new Error(`Private ChatGPT worker ended: ${worker.conclusion}. See private run logs.`);
        return worker;
      }
    } else if (now() > discoveryDeadline) throw new Error('Private dispatch not visible after five minutes; inspect private Actions before retrying');
    await sleep(30_000);
  }
  if (worker) gh(['api','--method','POST',`repos/${repo}/actions/runs/${worker.id}/cancel`]);
  throw new Error('Private worker exceeded parent waiting limit');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const gh = (args, input) => execFileSync('gh',args,{ input, encoding:'utf8', stdio:['pipe','pipe','pipe'] });
  let linked = false;
  runWorker({ gh, sleep: ms => new Promise(r=>setTimeout(r,ms)), report: w => {
    const md = `ChatGPT plan worker: [View private run](https://github.com/${repo}/actions/runs/${w.id})\n\nStatus: ${w.conclusion || w.status}.\n`;
    writeFileSync('/tmp/private-worker.md',md);
    writeFileSync('/tmp/private-worker-id',String(w.id));
    if (!linked) { console.log(md); if(process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,md); linked=true; }
  }}).catch(e=>{ console.error(`::error::${e.status ? 'Private worker API request failed; verify STEWARD_PAT access to polecat-steward.' : e.message}`); process.exitCode=1; });
}
