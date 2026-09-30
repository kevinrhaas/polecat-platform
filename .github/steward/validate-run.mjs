import { processorOf } from './lanes.mjs';
const e = process.env;
processorOf({ processor: e.PROCESSOR, model: e.MODEL, effort: e.EFFORT });
if (e.FOCUS_APP && !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(e.FOCUS_APP)) throw new Error('Invalid app');
if (e.LANE && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(e.LANE)) throw new Error('Invalid lane');
for (const key of ['INPUT_SLICE', 'INPUT_SLICES']) {
  if (e[key] && !/^(10|[1-9])$/.test(e[key])) throw new Error(`Invalid ${key}`);
}
if (Number(e.INPUT_SLICE || 1) > Number(e.INPUT_SLICES || 1)) throw new Error('Slice exceeds lane target');
if (e.INPUT_MAX_TURNS && !/^[1-9]\d{0,3}$/.test(e.INPUT_MAX_TURNS)) throw new Error('Invalid max_turns');
if (e.QUEUE_POSITION && !/^[1-9]\d*\/[1-9]\d*$/.test(e.QUEUE_POSITION)) throw new Error('Invalid queue position');
