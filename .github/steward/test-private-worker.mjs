import assert from 'node:assert/strict';
import {findWorker,runWorker} from './private-worker.mjs';
const worker={id:123,event:'workflow_dispatch',head_branch:'main',display_title:'9-1 — Steward improve — chicago',status:'completed',conclusion:'success'};
assert.equal(findWorker([worker],'9-1'),worker);
assert.equal(findWorker([worker],'9-10'),undefined);
assert.equal(findWorker([{...worker,head_branch:'evil'}],'9-1'),undefined);
const env={GITHUB_RUN_ID:'9',GITHUB_RUN_ATTEMPT:'1',WORKER_INPUTS:JSON.stringify({app:'chicago',processor:'gpt',model:'gpt-6-astra',effort:'xhigh'})};
let dispatched=0, reads=0;
await runWorker({env,sleep:async()=>{},report:()=>{},gh:(args,input)=>{
 if(args.includes('POST')) {dispatched++;assert.equal(JSON.parse(input).inputs.effort,'xhigh'); return '';}
 if(args.at(-1).includes('/runs?')) return JSON.stringify({workflow_runs:reads++? [worker]:[]});
 return JSON.stringify(worker);
}});
assert.equal(dispatched,1);
await runWorker({env,sleep:async()=>{},report:()=>{},gh:args=>{
 assert.ok(!args.includes('POST'),'reattach must not dispatch twice');
 return JSON.stringify(args.at(-1).includes('/runs?')?{workflow_runs:[worker]}:worker);
}});
await assert.rejects(()=>runWorker({env,sleep:async()=>{},report:()=>{},gh:args=>JSON.stringify(args.at(-1).includes('/runs?')?{workflow_runs:[worker]}:{...worker,conclusion:'failure'})}),/ended: failure/);
console.log('Private dispatch, reattachment, correlation, input forwarding and failure propagation passed.');
