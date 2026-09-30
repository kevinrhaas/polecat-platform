import assert from 'node:assert/strict';
import { appLanes, validateLane, freeSlots, dispatchInputs, laneTitle } from './lanes.mjs';
import { agentEvents } from './agent-events.mjs';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const roster = { apps: { chicago: { slices: 3 } }, lanes: {
  'deep-work': { app: 'chicago', processor: 'codex', model: 'gpt-6-astra', effort: 'xhigh', slices: 2 },
  'second-claude': { app: 'chicago', processor: 'claude', model: 'claude-opus-5-5', effort: 'max', slices: 3 },
} };
const [legacy, codex, claude] = appLanes(roster);
const runs = [
  { status: 'in_progress', displayTitle: 'Steward improve — chicago [1/3]' },
  { status: 'queued', displayTitle: 'Steward improve — chicago {deep-work} [2/2]' },
  { status: 'waiting', displayTitle: 'Steward improve — chicago {second-claude} [1/3]' },
  { status: 'completed', displayTitle: 'Steward improve — chicago {deep-work} [1/2]' },
  { status: 'in_progress', displayTitle: 'Steward improve — chicagoland [3/3]' },
];
assert.deepEqual(freeSlots(legacy, runs), [2, 3]);
assert.deepEqual(freeSlots(codex, runs), [1]);
assert.deepEqual(freeSlots(claude, runs), [2, 3]);
assert.deepEqual(freeSlots({ ...legacy, config: { slices: 1 } }, [
  { status: 'in_progress', displayTitle: 'Steward improve — chicago [3/3]' },
]), []); // drain lowered targets, including out-of-range slots
assert.deepEqual(dispatchInputs(codex, 2), { app: 'chicago', lane: 'deep-work', processor: 'codex', model: 'gpt-6-astra', effort: 'xhigh', slice: '2', slices: '2', max_turns: '' });
assert.equal(laneTitle(legacy), 'Steward improve — chicago');
for(const config of [{ processor: 'bad' }, { model: '$(echo injected)' }, { processor: 'codex', model: 'claude-opus-5' }, { slices: 11 }, { slices: 1.5 }, { max_turns: -1 }, { effort: 'ultra' }, { model: 'claude-haiku-4-5', effort: 'max' }]){
  assert.throws(() => validateLane({ app: 'chicago', config }));
}
assert.throws(() => validateLane({ id: 'bad {id}', app: 'chicago', config: {} }));
assert.throws(() => validateLane({ app: 'bad app', config: {} }));
assert.equal(validateLane(legacy).processor, 'claude');
assert.equal(validateLane(claude).effort, 'max');
assert.deepEqual(agentEvents({ type: 'item.completed', item: { id: '1', type: 'command_execution', exit_code: 0, aggregated_output: '42' } })[0].message.content[0], { type: 'tool_result', tool_use_id: '1', content: '42', is_error: false });
assert.equal(agentEvents({ type: 'turn.failed', error: { message: 'No access' } })[0].subtype, 'error');

// Execute the actual launcher with fake CLIs, proving argument boundaries,
// provider isolation, effort forwarding and nonzero failure propagation.
const temp = mkdtempSync(join(tmpdir(), 'lane-test-'));
try{
  const stub = '#!/usr/bin/env node\nconsole.log(JSON.stringify({args:process.argv.slice(2),claude:!!process.env.CLAUDE_CODE_OAUTH_TOKEN,codex:!!process.env.CODEX_API_KEY}));process.exit(Number(process.env.FAKE_EXIT||0));\n';
  for(const cli of ['claude', 'codex']) writeFileSync(join(temp, cli), stub, { mode: 0o755 });
  const run = (processor, model, effort, exit = 0) => spawnSync('bash', ['.github/steward/run-agent.sh', 'a prompt with "quotes" and $(text)'], {
    encoding: 'utf8', env: { ...process.env, PATH: temp + ':' + process.env.PATH,
      PROCESSOR: processor, MODEL: model, EFFORT: effort, CODEX_API_KEY: 'fake', CLAUDE_CODE_OAUTH_TOKEN: 'fake', FAKE_EXIT: String(exit) },
  });
  let result = run('claude', 'claude-opus-5-5', 'max');
  assert.equal(result.status, 0);
  let data = JSON.parse(result.stdout);
  assert.equal(data.codex, false); assert.equal(data.claude, true);
  assert.ok(data.args.includes('--effort')); assert.ok(data.args.includes('max'));
  result = run('codex', 'gpt-6-astra', 'xhigh'); data = JSON.parse(result.stdout);
  assert.equal(data.claude, false); assert.equal(data.codex, true);
  assert.ok(data.args.includes('model_reasoning_effort="xhigh"'));
  assert.ok(!data.args.includes('--max-turns'));
  assert.equal(run('codex', 'gpt-6-astra', 'xhigh', 17).status, 17);
  // Ensure native Codex commands produce the same factual ticket/PR record.
  const stream = join(temp, 'events.jsonl');
  writeFileSync(stream, [
    { type: 'item.started', item: { id: '1', type: 'command_execution', command: 'node tools/ticket.mjs claim T-1234' } },
    { type: 'item.completed', item: { id: '1', type: 'command_execution', exit_code: 0, aggregated_output: 'claimed' } },
    { type: 'item.completed', item: { type: 'agent_message', text: 'Work complete.' } },
    { type: 'turn.completed', usage: { input_tokens: 5, output_tokens: 7 } },
  ].map(e => JSON.stringify(e)).join('\n'));
  const recordPath = join(temp, 'record.json');
  const record = spawnSync('node', ['.github/steward/run-record.mjs', '--stream', stream, '--status', 'success', '--json', recordPath, '--md', join(temp, 'record.md')], { encoding: 'utf8' });
  assert.equal(record.status, 0, record.stderr);
  assert.deepEqual(JSON.parse(readFileSync(recordPath)).tickets_claimed, ['T-1234']);
}finally{ rmSync(temp, { recursive: true, force: true }); }
console.log('Lane isolation, capacity, validation, CLI dispatch and Codex records passed');
