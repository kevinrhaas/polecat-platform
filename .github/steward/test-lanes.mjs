import assert from 'node:assert/strict';
import { appLanes, busySlots, isLanePr, isResumablePr, processorOf, laneTitle, queueGate, queueLimits } from './lanes.mjs';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, cpSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const roster = { apps: { chicago: { enabled: true, slices: 3, model: 'claude-opus-5-5', effort: 'max' } },
  lanes: { 'chicago-gpt': { app: 'chicago', enabled: true, slices: 2, processor: 'gpt', model: 'gpt-6-astra', effort: 'xhigh' } } };
// Enabled but expired lanes must not reserve queue positions forever.
roster.lanes['expired'] = { app: 'chicago', enabled: true, slices: 10, until: '2000-01-01T00:00:00Z' };
const [claude, gpt] = appLanes(roster);
assert.equal(processorOf(claude.config).processor, 'claude');
assert.equal(processorOf(gpt.config).effort, 'xhigh');
assert.throws(() => processorOf({ processor: 'gpt', model: 'claude-opus-5' }));
assert.throws(() => processorOf({ model: '$(touch /tmp/injected)' }));
assert.throws(() => processorOf({ model: 'claude-haiku-4-5', effort: 'max' }));
assert.throws(() => appLanes({ lanes: { invalid: { app: '../other' } } }));
const runs = [
  { status: 'in_progress', displayTitle: laneTitle(claude) + ' [1/3]' },
  { status: 'queued', displayTitle: laneTitle(gpt) + ' [2/2]' },
  { status: 'completed', displayTitle: laneTitle(claude) + ' [2/3]' },
  { status: 'in_progress', displayTitle: 'Steward improve — chicago-other [3/3]' },
];
assert.deepEqual([...busySlots(runs, claude)], [1]);
assert.deepEqual([...busySlots(runs, gpt)], [2]);
assert.deepEqual([...busySlots([{status:'waiting',displayTitle:laneTitle(gpt)}], gpt)], [1]);

// Execute the REAL dispatcher with an isolated roster and fake GitHub endpoint.
const dir = mkdtempSync(path.join(tmpdir(), 'lanes-'));
try {
  for (const file of ['dispatch-lanes.mjs','lanes.mjs','schedule.mjs']) cpSync(new URL(file, import.meta.url), path.join(dir,file));
  writeFileSync(path.join(dir,'focus.json'), JSON.stringify(roster));
  mkdirSync(path.join(dir,'bin'));
  // Fake GitHub: a status-filtered query is --slurp'd (array of pages); the
  // unfiltered one returns one page. A run flagged `lagging` is missing from
  // every FILTERED listing, as a just-promoted run is on the real API. The
  // unfiltered page is padded past 1 MB, as real pages are (full commit
  // messages), so a dispatcher using execFileSync's default buffer fails here.
  writeFileSync(path.join(dir,'bin/gh'), `#!/usr/bin/env node\nconst fs=require('fs');const a=process.argv.slice(2);if(a[0]==='api'&&a.some(x=>x.includes('/pulls'))){if(process.env.PRS_BROKEN)process.exit(1);fs.appendFileSync(process.env.TOKENS,process.env.GH_TOKEN+'\\n');console.log(JSON.stringify([JSON.parse(process.env.PRS||'[]')]));process.exit(0);}if(a[0]==='api'&&a.some(x=>x.includes('actions/variables'))){if(a.includes('--method')){fs.appendFileSync(process.env.VARS,a[a.indexOf('--method')+1]+' '+a.find(x=>x.includes('actions/variables'))+'\\n');process.exit(0);}process.exit(process.env.PAUSED?0:1);}if(a[0]==='api'){if(process.env.BROKEN)process.exit(1);const runs=JSON.parse(process.env.RUNS).map((r,i)=>({...r,id:i}));const url=a.at(-1);const out=rs=>rs.map(r=>({id:r.id,status:r.status,display_title:r.displayTitle,created_at:r.createdAt}));if(url.includes('status=')){console.log(JSON.stringify([{workflow_runs:out(runs.filter(r=>!r.lagging&&url.includes('status='+r.status+'&')))}]));}else console.log(JSON.stringify({workflow_runs:out(runs),pad:'x'.repeat(2e6)}));}else fs.appendFileSync(process.env.CALLS,JSON.stringify(a)+'\\n');`, {mode:0o755});
  const calls = path.join(dir,'calls');
  const env = {...process.env, PATH:path.join(dir,'bin')+':'+process.env.PATH, RUNS:JSON.stringify(runs), CALLS:calls};
  let result = spawnSync(process.execPath,[path.join(dir,'dispatch-lanes.mjs')], {env,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const dispatched = readFileSync(calls,'utf8').trim().split('\n').map(l=>JSON.parse(l).filter((v,i,a)=>a[i-1]==='-f')).map(a=>Object.fromEntries(a.map(v=>v.split('='))));
  assert.deepEqual(dispatched.map(d=>[d.lane,d.slice,d.queue_position]), [['','2','2/5'],['','3','3/5'],['chicago-gpt','1','4/5']]);
  assert.equal(dispatched[2].processor,'gpt'); assert.equal(dispatched[2].model,'gpt-6-astra'); assert.equal(dispatched[2].effort,'xhigh');
  writeFileSync(calls,'');
  result=spawnSync(process.execPath,[path.join(dir,'dispatch-lanes.mjs')],{env:{...env,BROKEN:'1'},encoding:'utf8'});
  assert.notEqual(result.status,0); assert.equal(readFileSync(calls,'utf8'),'');
  // Lowered capacity drains surplus slots without filling a low-numbered hole.
  roster.apps.chicago.slices=1; roster.lanes['chicago-gpt'].enabled=false;
  writeFileSync(path.join(dir,'focus.json'),JSON.stringify(roster));
  result=spawnSync(process.execPath,[path.join(dir,'dispatch-lanes.mjs')],{env:{...env,RUNS:JSON.stringify([{status:'in_progress',displayTitle:laneTitle(claude)+' [3/3]'}])},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.equal(readFileSync(calls,'utf8'),'');
  // A slot whose run is mid-transition (absent from every status filter) is
  // still busy: no duplicate dispatch into its concurrency group.
  result=spawnSync(process.execPath,[path.join(dir,'dispatch-lanes.mjs')],{env:{...env,RUNS:JSON.stringify([{status:'in_progress',lagging:true,displayTitle:laneTitle(claude)+' [1/1]'}])},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.equal(readFileSync(calls,'utf8'),'');
  // ...and a completed run in the unfiltered page does not hold its slot.
  result=spawnSync(process.execPath,[path.join(dir,'dispatch-lanes.mjs')],{env:{...env,RUNS:JSON.stringify([{status:'completed',displayTitle:laneTitle(claude)+' [1/1]'}])},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.equal(readFileSync(calls,'utf8').trim().split('\n').length,1);
  // T-2153: the run that kicked this tick (FREED_RUN) is still in_progress
  // while it tears down, but its slot is free. Any OTHER id leaves the slot busy.
  writeFileSync(calls,'');
  const finishing=JSON.stringify([{status:'in_progress',displayTitle:laneTitle(claude)+' [1/1]'}]);
  result=spawnSync(process.execPath,[path.join(dir,'dispatch-lanes.mjs')],{env:{...env,RUNS:finishing,FREED_RUN:'0'},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/Run 0 kicked this tick/);
  const refill=readFileSync(calls,'utf8').trim().split('\n').map(l=>JSON.parse(l));
  assert.equal(refill.length,1);assert.ok(refill[0].includes('slice=1'));
  writeFileSync(calls,'');
  result=spawnSync(process.execPath,[path.join(dir,'dispatch-lanes.mjs')],{env:{...env,RUNS:finishing,FREED_RUN:'7'},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.equal(readFileSync(calls,'utf8'),'');

  // PR-queue backpressure (lanes.mjs § queueGate). Pure gate first.
  const qc={prQueue:{pauseAt:6,resumeAt:3}};
  assert.equal(queueGate({},{open:40}).cap,Infinity);
  assert.equal(queueGate(qc,{open:null}).paused,false);
  assert.deepEqual(queueLimits({prQueue:{pauseAt:6}}),{pauseAt:6,resumeAt:3});
  assert.deepEqual(queueLimits({prQueue:{pauseAt:2,resumeAt:9}}),{pauseAt:2,resumeAt:1});
  assert.equal(queueLimits({prQueue:{pauseAt:'x'}}),null);
  assert.deepEqual([queueGate(qc,{open:2}).paused,queueGate(qc,{open:2}).cap],[false,Infinity]);
  assert.equal(queueGate(qc,{open:5,busy:3}).cap,Infinity);
  assert.equal(queueGate(qc,{open:6,busy:0}).finishOnly,true);
  assert.deepEqual([queueGate(qc,{open:6,resumable:4,busy:1}).paused,queueGate(qc,{open:6,resumable:4,busy:1}).cap,queueGate(qc,{open:6,resumable:4,busy:1}).finishOnly],[true,3,true]);
  // What a finish-only slice may take: non-draft `resume` or `stuck`.
  assert.deepEqual([{labels:[{name:'resume'}]},{labels:[{name:'stuck'}]},{labels:[{name:'stuck'}],draft:true},{labels:[]},{},null].map(isResumablePr),[true,true,false,false,false,false]);
  // Hysteresis: between the two limits the last tick's state holds.
  assert.equal(queueGate(qc,{open:4,wasPaused:true}).paused,true);
  assert.equal(queueGate(qc,{open:4,wasPaused:false}).paused,false);
  assert.equal(queueGate(qc,{open:3,wasPaused:true}).paused,false);

  // Then the real dispatcher: a lane over its limit pauses, records it, and
  // sends finish-only slices only for resume PRs nobody touched for 30 min.
  roster.apps.chicago={enabled:true,slices:5,prQueue:{pauseAt:6,resumeAt:3}};
  writeFileSync(path.join(dir,'focus.json'),JSON.stringify(roster));
  const vars=path.join(dir,'vars'), tokens=path.join(dir,'tokens'); writeFileSync(vars,''); writeFileSync(tokens,''); writeFileSync(calls,'');
  const old='2026-01-01T00:00:00Z', fresh=new Date().toISOString();
  const pr=(labels,extra={})=>({draft:false,labels:labels.map(name=>({name})),updated_at:old,head:{ref:'steward/t-x'},...extra});
  const seven=[pr(['resume']),pr(['resume']),pr(['resume'],{updated_at:fresh}),pr([]),pr([]),pr([]),pr(['hold']),pr([],{draft:true})];
  const qenv={...env,RUNS:'[]',VARS:vars,TOKENS:tokens,PR_TOKEN:'pat',PRS:JSON.stringify(seven)};
  result=spawnSync(process.execPath,[path.join(dir,'dispatch-lanes.mjs')],{env:qenv,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  // Seven: the draft counts, `hold` does not.
  assert.match(result.stdout,/chicago lane PAUSED: 7 open PRs/);
  let sent=readFileSync(calls,'utf8').trim().split('\n').map(l=>JSON.parse(l));
  assert.equal(sent.length,2); assert.ok(sent.every(c=>c.includes('finish_only=1')));
  assert.match(readFileSync(vars,'utf8'),/^POST repos\/.*\/actions\/variables\n$/);
  assert.equal(readFileSync(tokens,'utf8').trim(),'pat');
  // Still paused at 5 (above resumeAt): finish-only, no state change.
  writeFileSync(calls,''); writeFileSync(vars,'');
  result=spawnSync(process.execPath,[path.join(dir,'dispatch-lanes.mjs')],{env:{...qenv,PAUSED:'1',PRS:JSON.stringify(seven.slice(2))},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr); assert.equal(readFileSync(vars,'utf8'),'');
  assert.equal(readFileSync(calls,'utf8'),'');
  // Down to 3: restarts, deletes the variable, and fills every free slot (5).
  writeFileSync(calls,''); writeFileSync(vars,'');
  result=spawnSync(process.execPath,[path.join(dir,'dispatch-lanes.mjs')],{env:{...qenv,PAUSED:'1',PRS:JSON.stringify(seven.slice(3,6))},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr); assert.match(result.stdout,/RESTARTED/);
  assert.match(readFileSync(vars,'utf8'),/^DELETE repos\/.*STEWARD_PAUSED_CHICAGO\n$/);
  sent=readFileSync(calls,'utf8').trim().split('\n').map(l=>JSON.parse(l));
  assert.equal(sent.length,5); assert.ok(sent.every(c=>!c.includes('finish_only=1')));
  // Drafts alone pause the lane (2026-10-17: 23 drafts read as 2), and a
  // draft carrying `resume` earns no finish-only slice.
  writeFileSync(calls,''); writeFileSync(vars,'');
  const drafts=Array.from({length:6},()=>pr(['resume'],{draft:true}));
  result=spawnSync(process.execPath,[path.join(dir,'dispatch-lanes.mjs')],{env:{...qenv,PRS:JSON.stringify(drafts)},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/chicago lane PAUSED: 6 open PRs/);
  assert.equal(readFileSync(calls,'utf8'),'');
  // 2026-10-25: two `stuck` PRs and four drafts held chicago paused with 0
  // resumable for 4 h. A non-draft `stuck` PR now earns a finish-only slice;
  // a stuck draft and a held stuck PR still do not.
  writeFileSync(calls,''); writeFileSync(vars,'');
  const deadQueue=[pr(['stuck']),pr(['stuck']),pr([],{draft:true}),pr(['resume'],{draft:true}),pr(['stuck'],{draft:true}),pr([],{draft:true}),pr(['stuck','hold'])];
  result=spawnSync(process.execPath,[path.join(dir,'dispatch-lanes.mjs')],{env:{...qenv,PRS:JSON.stringify(deadQueue)},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/paused: 6 open PR\(s\), 2 resumable/);
  sent=readFileSync(calls,'utf8').trim().split('\n').map(l=>JSON.parse(l));
  assert.equal(sent.length,2); assert.ok(sent.every(c=>c.includes('finish_only=1')));
  // Finish-only cool-down (2026-10-18: ~270 no-op finish-only runs, one every
  // ~2 min at a resume PR still waiting on another ticket). A paused lane that
  // started a run in the last 30 minutes starts no finish-only work, even when
  // that run is the one whose kick freed the slot.
  const recentRun=[{status:'completed',displayTitle:laneTitle({app:'chicago'})+' [1/5]',createdAt:new Date(Date.now()-5*60000).toISOString()}];
  for (const extra of [{},{FREED_RUN:'0'}]) {
    writeFileSync(calls,''); writeFileSync(vars,'');
    result=spawnSync(process.execPath,[path.join(dir,'dispatch-lanes.mjs')],{env:{...qenv,PAUSED:'1',RUNS:JSON.stringify(recentRun),...extra},encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    assert.match(result.stdout,/finish-only cooling down, last run started 5m ago/);
    assert.equal(readFileSync(calls,'utf8'),'');
  }
  // Past 30 minutes the finish-only slices go out again.
  writeFileSync(calls,'');
  const oldRun=[{...recentRun[0],createdAt:new Date(Date.now()-40*60000).toISOString()}];
  result=spawnSync(process.execPath,[path.join(dir,'dispatch-lanes.mjs')],{env:{...qenv,PAUSED:'1',RUNS:JSON.stringify(oldRun)},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  sent=readFileSync(calls,'utf8').trim().split('\n').map(l=>JSON.parse(l));
  assert.equal(sent.length,2); assert.ok(sent.every(c=>c.includes('finish_only=1')));
  // A RUNNING lane is never cooled: a recent run does not hold back new tickets.
  writeFileSync(calls,'');
  result=spawnSync(process.execPath,[path.join(dir,'dispatch-lanes.mjs')],{env:{...qenv,RUNS:JSON.stringify(recentRun),PRS:'[]'},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  assert.equal(readFileSync(calls,'utf8').trim().split('\n').length,5);
  // Only the lane's own PRs count (2026-10-19): steward/* branches and
  // salvage's rescued drafts do; another session's claude/* drafts do not.
  assert.equal(isLanePr({head:{ref:'steward/t2787-k01-tower'}}),true);
  assert.equal(isLanePr({head:{ref:'lap886'},title:'WIP: lap886 — rescued from run 38931513397'}),true);
  assert.equal(isLanePr({head:{ref:'claude/t2659-sound'},title:'T-2659: Navigator sound'}),false);
  assert.equal(isLanePr({head:{ref:'chore/polecat-shell-v1.2.0'}}),false);
  writeFileSync(calls,''); writeFileSync(vars,'');
  const others=Array.from({length:6},(_,i)=>pr([],{draft:true,head:{ref:'claude/nav-'+i}}));
  result=spawnSync(process.execPath,[path.join(dir,'dispatch-lanes.mjs')],{env:{...qenv,PRS:JSON.stringify([...others,pr([])])},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/running: 1 open PR\(s\)/);
  assert.equal(readFileSync(calls,'utf8').trim().split('\n').length,5);
  // A failed PR count fails OPEN: the lane fills as if it had no limit.
  writeFileSync(calls,'');
  result=spawnSync(process.execPath,[path.join(dir,'dispatch-lanes.mjs')],{env:{...qenv,PRS_BROKEN:'1'},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr); assert.equal(readFileSync(calls,'utf8').trim().split('\n').length,5);
} finally { rmSync(dir,{recursive:true,force:true}); }

const events = [
  {type:'item.started',item:{id:'c1',type:'command_execution',command:'node tools/ticket.mjs claim T-1752'}},
  {type:'item.completed',item:{id:'c1',type:'command_execution',command:'node tools/ticket.mjs claim T-1752',aggregated_output:'claimed',exit_code:0}},
  {type:'item.completed',item:{type:'agent_message',text:'Completed unit'}},
  {type:'turn.completed',usage:{input_tokens:12,output_tokens:4}},
];
const stream=spawnSync(process.execPath,[new URL('codex-stream.mjs',import.meta.url).pathname],{input:events.map(e=>JSON.stringify(e)).join('\n'),encoding:'utf8'});
assert.equal(stream.status,0);
const normalized=stream.stdout.trim().split('\n').map(l=>JSON.parse(l));
assert.equal(normalized.filter(e=>e.message?.content?.[0]?.type==='tool_use').length,1);
assert.equal(normalized.at(-1).result,'Completed unit');
const logDir=mkdtempSync(path.join(tmpdir(),'lane-log-'));
try {
  const log=spawnSync(process.execPath,[new URL('stream-log.mjs',import.meta.url).pathname,path.join(logDir,'out')],{input:stream.stdout,encoding:'utf8'});
  assert.equal(log.status,0);assert.match(log.stdout,/cost not reported/);assert.doesNotMatch(log.stdout,/\$0\.00/);
} finally {rmSync(logDir,{recursive:true,force:true});}
const failure=spawnSync(process.execPath,[new URL('codex-stream.mjs',import.meta.url).pathname],{input:JSON.stringify({type:'turn.failed',error:{message:'No model access'}})+'\n',encoding:'utf8'});
assert.equal(failure.status,1);assert.match(failure.stdout,/No model access/);
console.log('Mixed lane dispatch, occupancy, draining, PR-queue backpressure, validation and GPT evidence: PASS');
