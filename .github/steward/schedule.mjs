#!/usr/bin/env node
// schedule.mjs — the canonical focus-lane schedule evaluator.
//
// steward-focus.yml runs `node .github/steward/schedule.mjs due` every 10 MIN
// (its cron heartbeat, TICK_MINUTES) and dispatches one improve run per printed
// app that is idle. Lane fields (focus.json, all optional beyond `enabled`):
//
//   enabled     bool — master switch for the lane.
//   everyHours  int ≥1 — coarse cadence gate (1 = eligible EVERY tick, so the
//               lane runs about as fast as its runs finish; 2 = even UTC hours…).
//               steward-focus tops the lane up to `slices` on each eligible
//               tick, so 1 is what continuous operation wants; a coarser
//               cadence only refills on the hours the lane is due.
//
//               IT MEANS SOMETHING DIFFERENT FOR A `jobs` ENTRY, and the
//               difference is the whole of T-1125. An APP lane is topped up to
//               `slices` and wants to be eligible constantly; a JOB has no
//               slices, so "eligible every tick" is not a cadence at all — it
//               is as often as the ticks come. Measured 2026-09-14, janitor at
//               everyHours 1: dispatched at 12:52, 12:59, 13:03, 13:28, 13:36,
//               13:43, 13:51 — roughly every eight minutes, because that is how
//               often steward-focus's cron fires.
//
//               It had LOOKED hourly only by accident: while the janitor was
//               stuck on kevinrhaas/custom each run took the full 55-minute
//               timeout, and the skip-if-busy guard swallowed the other ticks.
//               Once `custom` left FLEET the runs finished in 1-4 minutes and
//               there was nothing left to absorb them.
//
//               So for jobs, steward-focus adds an AGE gate on top of this one:
//               a job is dispatched only if its last run began more than
//               everyHours ago. `everyHours: 1` then means what the Manager
//               dial says it means — once an hour.
//
//               THAT GATE IS NOT DONE WITH CLOCK ARITHMETIC, and the reason is
//               measured too. "Fire on the first tick of the hour" is the
//               obvious implementation and it would silently skip hours: the
//               cron is nominally */10 but GitHub throttles scheduled events
//               hard, and on the same afternoon it fired at minutes 2, 50, 43,
//               34, 23, 2, 51, 33, 3 and 51. An hour whose early tick is
//               throttled away would never fire at all. The age of the last RUN
//               is immune to that; wall-clock tick position is not.
//   offset      int — which hours the cadence lands on: runs when
//               hourUTC % everyHours === offset. This is how "align the next
//               run to 21:00" works (offset = 21 % everyHours).
//   window      [startUTC, endUTC) — only run inside this UTC hour window;
//               wraps midnight when start > end (e.g. [22, 6]).
//   startAt     ISO datetime — the lane sleeps until this moment.
//   until       ISO datetime — the lane expires at this moment ("run every
//               X until Y"); expired lanes simply stop matching. Flip
//               `enabled` off (or clear `until`) to tidy up later.
//   slices      int 1..10 (default 1) — how many independent improve runs the
//               lane fires IN PARALLEL each time it is due. Each slice is a
//               full, separate unit of work (its own PR + smoke gate) running
//               at the same time as its siblings; each is told "slice k of N"
//               and takes the k-th topmost workable item so they don't collide.
//               Raise it to grind an app harder for a while.
//
// Manager's Fleet Ops mirrors this logic for its next-run previews in
// js/schedule.js — KEEP THE TWO IN SYNC (they are deliberately tiny).
import { readFileSync } from 'node:fs';

export function isDueAt(lane, date){
  if(!lane || !lane.enabled) return false;
  if(lane.startAt && date < new Date(lane.startAt)) return false;
  if(lane.until && date >= new Date(lane.until)) return false;
  const every = Math.max(1, lane.everyHours || 1);
  const offset = ((lane.offset || 0) % every + every) % every;
  const hour = date.getUTCHours();
  if(hour % every !== offset) return false;
  const w = lane.window;
  if(Array.isArray(w) && w.length === 2 && w[0] !== w[1]){
    const inWin = w[0] < w[1] ? (hour >= w[0] && hour < w[1]) : (hour >= w[0] || hour < w[1]);
    if(!inWin) return false;
  }
  return true;
}

// How many independent improve runs a lane fires in parallel per fired tick
// (default 1, clamped to 1..10). Slices don't change WHEN a lane fires — only
// how many units it kicks off at once — so nextRunAt/isDueAt ignore it.
export function slicesOf(lane){
  const n = Math.floor(Number(lane && lane.slices) || 1);
  return Math.max(1, Math.min(10, n));
}

// The loop's heartbeat: the scheduler ticks every TICK_MINUTES (steward-focus's
// cron). Previews advance by ticks, not hours, so a lane eligible every tick
// shows its next run within ~10 min.
export const TICK_MINUTES = 10;

// The next tick (10-min UTC grid) at which the lane will fire, or null.
export function nextRunAt(lane, from = new Date(), tick = TICK_MINUTES){
  if(!lane || !lane.enabled) return null;
  const t = new Date(from); t.setUTCSeconds(0, 0);
  // advance to the next tick boundary strictly after `from`
  t.setUTCMinutes(t.getUTCMinutes() - (t.getUTCMinutes() % tick) + tick);
  const steps = 14 * 24 * (60 / tick);
  for(let i = 0; i < steps; i++){
    if(lane.until && t >= new Date(lane.until)) return null;
    if(isDueAt(lane, t)) return t;
    t.setUTCMinutes(t.getUTCMinutes() + tick);
  }
  return null;
}

// ---- CLI (used by steward-focus.yml; handy for humans too) -----------------
//   due       → app lane names due at THIS tick, one per line (ONCE per app;
//               steward-focus reads the lane's slice count via `slices-of` and
//               dispatches that many runs AT ONCE, slice=1..N)
//   slices-of → the slice count (1..10, default 1) for one app lane — how many
//               concurrent improve runs the lane should keep going
//   due-jobs  → platform job names due at THIS tick (focus.json `jobs`)
//   next      → "name<TAB>iso-or-never" for every app lane AND job
const cmd = process.argv[2];
if(cmd){
  const f = JSON.parse(readFileSync(new URL('./focus.json', import.meta.url), 'utf8'));
  const now = new Date();
  if(cmd === 'due'){
    for(const [app, lane] of Object.entries(f.apps || {})) if(isDueAt(lane, now)) console.log(app);
  }else if(cmd === 'slices-of'){
    const lane = (f.apps || {})[process.argv[3]];
    console.log(lane ? slicesOf(lane) : 1);
  }else if(cmd === 'model-of'){
    // The lane's pinned Claude model ('' = the fleet default, opus — applied
    // in steward-improve.yml). steward-focus passes it through to
    // steward-improve as the run's --model.
    const lane = (f.apps || {})[process.argv[3]];
    console.log((lane && lane.model) || '');
  }else if(cmd === 'max-turns-of'){
    // The lane's tool-call ceiling ('' = the workflow default, 200). Two custom
    // runs on 2026-09-03 (#1459, #1466) hit 200 with the clock barely half
    // spent — reading one census sheet costs ~60 calls — so the custom lane
    // carries 400; steward-focus passes it through as --max-turns.
    const lane = (f.apps || {})[process.argv[3]];
    console.log((lane && lane.max_turns) || '');
  }else if(cmd === 'every-hours-of-job'){
    // The job's cadence in hours, for steward-focus's age gate. Printed as a
    // bare number so the shell can compare it without parsing anything, and 0
    // for a job the roster does not hold — which the caller reads as "no age
    // gate", the pre-T-1125 behaviour, rather than as "never run me".
    const lane = (f.jobs || {})[process.argv[3]];
    console.log(lane ? Math.max(1, lane.everyHours || 1) : 0);
  }else if(cmd === 'due-jobs'){
    for(const [job, lane] of Object.entries(f.jobs || {})) if(isDueAt(lane, now)) console.log(job);
  }else if(cmd === 'next'){
    for(const [app, lane] of Object.entries(f.apps || {})) console.log(`${app}\t${nextRunAt(lane, now)?.toISOString() || 'never'}`);
    for(const [job, lane] of Object.entries(f.jobs || {})) console.log(`job:${job}\t${nextRunAt(lane, now)?.toISOString() || 'never'}`);
  }else{
    console.error('usage: schedule.mjs due|slices-of <app>|model-of <app>|max-turns-of <app>|due-jobs|next'); process.exit(2);
  }
}
