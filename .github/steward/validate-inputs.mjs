import { validateLane } from './lanes.mjs';
const e = process.env;
validateLane({ id: e.STEWARD_LANE, app: e.FOCUS_APP || 'fleet', config: {
  processor: e.PROCESSOR, model: e.MODEL, effort: e.EFFORT,
  slices: Number(e.SLICES), max_turns: Number(e.MAX_TURNS),
} });
const slice = Number(e.SLICE);
if(!Number.isInteger(slice) || slice < 1 || slice > Number(e.SLICES)) throw new Error('Slice must be within concurrency target');
