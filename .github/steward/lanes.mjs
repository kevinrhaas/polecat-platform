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

// PR-QUEUE BACKPRESSURE (focus.json lane `prQueue: { pauseAt, resumeAt }`).
// On 2026-10-12 chicago x5 had seven PRs open at once. Each bake asks for 18
// smoke legs, so the account's hosted runners were full, legs sat queued for
// 30+ minutes, and every merge to dev re-lapped the rest and restarted their
// bakes. The queue only cleared once the lane was switched off by hand.
//
// This is that switch, thrown by the scheduler. Once `pauseAt` PRs are open the
// lane PAUSES: no slice takes a new ticket. It is not switched OFF, because a
// `resume` PR is the loop's own unfinished work and nothing but a slice
// finishes it, so a paused lane still sends FINISH-ONLY slices, one per
// resumable PR not already covered by a running slice. It stays paused until
// the queue is down to `resumeAt`; that gap is what stops it flapping at the
// limit. While running, a tick starts no more new tickets than would take the
// queue to `pauseAt`.
//
//   open       open PRs on the app's repo, drafts included, `hold` excluded
//              (the owner's park switch is not load); null = the count
//              failed, and the gate fails OPEN so a GitHub hiccup never
//              stalls the loop. Drafts count since 2026-10-17: 23 open
//              drafts on chicago read as 2 and never paused the lane.
//   resumable  how many non-draft ones carry `resume`
//   wasPaused  the state the last tick left (see dispatch-lanes.mjs)
//   busy       slots already running in this lane
export function queueLimits(config) {
  const q = config && config.prQueue;
  if (!q || typeof q !== 'object') return null;
  const pauseAt = Math.floor(Number(q.pauseAt));
  if (!(pauseAt >= 1)) return null;
  const want = q.resumeAt === undefined ? Math.floor(pauseAt / 2) : Math.floor(Number(q.resumeAt));
  const resumeAt = Math.max(0, Math.min(pauseAt - 1, Number.isFinite(want) ? want : 0));
  return { pauseAt, resumeAt };
}
export function queueGate(config, { open, resumable = 0, wasPaused = false, busy = 0 }) {
  const limits = queueLimits(config);
  if (!limits || open === null || open === undefined) return { paused: false, finishOnly: false, cap: Infinity, why: '' };
  const { pauseAt, resumeAt } = limits;
  const paused = wasPaused ? open > resumeAt : open >= pauseAt;
  if (paused) {
    const cap = Math.max(0, resumable - busy);
    return { paused, finishOnly: true, cap,
      why: `paused: ${open} open PR(s), ${resumable} resumable (pauses at ${pauseAt}, restarts at ${resumeAt}) — ${cap} finish-only slice(s) allowed` };
  }
  // Running: every free slot fills. Only the open-PR count pauses the lane;
  // busy slices never hold one back (Kevin, 2026-10-12: 5 running with up
  // to 5 open is fine, 6 open pauses new tickets).
  return { paused, finishOnly: false, cap: Infinity,
    why: `running: ${open} open PR(s) (pauses at ${pauseAt}) — every free slot fills` };
}
