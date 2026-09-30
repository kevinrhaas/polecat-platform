// Backwards-compatible roster: apps remain default lanes; lanes adds named ones.
export const EFFORTS = ['', 'low', 'medium', 'high', 'xhigh', 'max'];
export function processorOf(lane = {}) {
  const processor = lane.processor || 'claude';
  if (!['claude', 'gpt'].includes(processor)) throw new Error(`Unknown processor: ${processor}`);
  const model = lane.model || (processor === 'gpt' ? 'gpt-6-astra' : 'claude-opus-5');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:[\]-]{0,119}$/.test(model)) throw new Error('Invalid model ID');
  if (processor === 'gpt' && /^claude-/.test(model) || processor === 'claude' && /^gpt-/.test(model)) throw new Error('Model and processor do not match');
  const effort = lane.effort || '';
  if (!EFFORTS.includes(effort)) throw new Error(`Invalid effort: ${effort}`);
  if (/haiku/.test(model) && effort) throw new Error('Haiku does not support effort; choose default');
  return { processor, model, effort };
}
export function appLanes(roster) {
  const out = [];
  for (const [app, config] of Object.entries(roster.apps || {})) out.push({ id: '', app, config });
  for (const [id, config] of Object.entries(roster.lanes || {})) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw new Error(`Invalid lane ID: ${id}`);
    out.push({ id, app: config.app, config });
  }
  for (const lane of out) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(lane.app || '')) throw new Error('Invalid lane app');
    processorOf(lane.config);
  }
  return out;
}
export function laneTitle({ app, id }) {
  return `Steward improve — ${app}${id ? ` {${id}}` : ''}`;
}
export function busySlots(runs, lane) {
  const title = laneTitle(lane);
  const slots = new Set();
  for (const run of runs) {
    if (run.status === 'completed') continue;
    if (run.displayTitle === title) slots.add(1);
    else if (run.displayTitle?.startsWith(title + ' [')) {
      const match = run.displayTitle.slice(title.length).match(/^ \[(\d+)\/\d+\]$/);
      if (match) slots.add(Number(match[1]));
    }
  }
  return slots;
}
