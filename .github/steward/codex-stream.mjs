// Adapt Codex events to the steward's journal/record contract. Tool evidence is
// retained even if a run fails before its final message.
import readline from 'node:readline';
const emit = event => process.stdout.write(JSON.stringify(event) + '\n');
let last = '', failed = false;
const commands = new Set();
for await (const line of readline.createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  let e; try { e = JSON.parse(line); } catch { emit({ type: 'system', message: line }); continue; }
  const item = e.item;
  if (e.type === 'thread.started') emit({ type: 'system', subtype: 'init', session_id: e.thread_id });
  if (item?.type === 'command_execution') {
    if (!commands.has(item.id)) {
      commands.add(item.id);
      emit({ type: 'assistant', message: { content: [{ type: 'tool_use', id: item.id, name: 'Bash', input: { command: item.command } }] } });
    }
    if (e.type === 'item.completed') emit({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: item.id, content: item.aggregated_output || '', is_error: item.exit_code !== 0 }] } });
  } else if (e.type === 'item.completed' && item?.type === 'agent_message') {
    last = item.text;
    emit({ type: 'assistant', message: { content: [{ type: 'text', text: last }] } });
  } else if (e.type === 'error' || e.type === 'turn.failed') {
    failed = true;
    emit({ type: 'result', subtype: 'error', is_error: true, result: e.message || e.error?.message || 'GPT run failed' });
  } else if (e.type === 'turn.completed') {
    emit({ type: 'result', subtype: 'success', result: last, usage: e.usage });
  } else {
    // Preserve original non-command events for diagnostics.
    emit({ type: 'codex_event', event: e });
  }
}
if (failed) process.exitCode = 1;
