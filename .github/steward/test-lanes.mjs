import assert from 'node:assert/strict';
import { appLanes, busySlots, processorOf, laneTitle } from './lanes.mjs';
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
  writeFileSync(path.join(dir,'bin/gh'), `#!/usr/bin/env node\nconst fs=require('fs');const a=process.argv.slice(2);if(a[0]==='api'){if(process.env.BROKEN)process.exit(1);const runs=JSON.parse(process.env.RUNS).map((r,i)=>({...r,id:i}));const url=a.at(-1);const out=rs=>rs.map(r=>({id:r.id,status:r.status,display_title:r.displayTitle}));if(url.includes('status=')){console.log(JSON.stringify([{workflow_runs:out(runs.filter(r=>!r.lagging&&url.includes('status='+r.status+'&')))}]));}else console.log(JSON.stringify({workflow_runs:out(runs),pad:'x'.repeat(2e6)}));}else fs.appendFileSync(process.env.CALLS,JSON.stringify(a)+'\\n');`, {mode:0o755});
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
console.log('Mixed lane dispatch, occupancy, draining, validation and GPT evidence: PASS');
