// Normalize Codex JSONL into the existing journal's event contract. Raw
// artifacts retain the original provider events; no outcomes are inferred.
export function agentEvents(ev){
  const item = ev.item;
  if(ev.type === 'item.started' && item?.type === 'command_execution') return [{
    type: 'assistant', message: { content: [{ type: 'tool_use', id: item.id,
      name: 'Bash', input: { command: item.command } }] },
  }];
  if(ev.type === 'item.completed' && item?.type === 'command_execution') return [{
    type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: item.id,
      content: item.aggregated_output || '', is_error: item.status === 'failed' || (item.exit_code != null && item.exit_code !== 0) }] },
  }];
  if(ev.type === 'item.completed' && item?.type === 'agent_message') return [{
    type: 'assistant', message: { content: [{ type: 'text', text: item.text }] },
  }];
  if(ev.type === 'turn.completed') return [{ type: 'result', subtype: 'success', usage: ev.usage }];
  if(ev.type === 'turn.failed' || ev.type === 'error') return [{ type: 'result', subtype: 'error', error: ev.error?.message || ev.message || 'Agent failed' }];
  // Other Codex events stay in raw artifacts without cluttering the live log.
  if(ev.type?.startsWith('item.') || ev.type?.startsWith('thread.') || ev.type === 'turn.started') return [];
  return [ev];
}
