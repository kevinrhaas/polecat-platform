#!/usr/bin/env node
// schedule.mjs — the canonical focus-lane schedule evaluator.
//
// steward-focus.yml runs `node .github/steward/schedule.mjs due` on its
// hourly tick and dispatches one improve run per printed app. Lane fields
// (focus.json, all optional beyond `enabled`):
//
//   enabled     bool — master switch for the lane.
//   everyHours  int ≥1 — cadence (1 = every hour, 2 = every other hour…).
//   offset      int — which hours the cadence lands on: runs when
//               hourUTC % everyHours === offset. This is how "align the next
//               run to 21:00" works (offset = 21 % everyHours).
//   window      [startUTC, endUTC) — only run inside this UTC hour window;
//               wraps midnight when start > end (e.g. [22, 6]).
//   startAt     ISO datetime — the lane sleeps until this moment.
//   until       ISO datetime — the lane expires at this moment ("run every
//               X until Y"); expired lanes simply stop matching. Flip
//               `enabled` off (or clear `until`) to tidy up later.
//   slices      int 1..5 (default 1) — how many independent improve runs to
//               dispatch each time the lane fires. Each slice is a full,
//               separate unit of work (its own PR + smoke gate), serialized by
//               steward-improve's per-app concurrency group so the app never
//               overlaps itself. Raise it to grind an app harder for a while.
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

// How many independent improve runs a lane dispatches per fired tick (default
// 1, clamped to 1..5). Slices don't change WHEN a lane fires — only how many
// units of work it kicks off that hour — so nextRunAt/isDueAt ignore it.
export function slicesOf(lane){
  const n = Math.floor(Number(lane && lane.slices) || 1);
  return Math.max(1, Math.min(5, n));
}

// The next tick (hh:tickMinute UTC) at which the lane will fire, or null.
export function nextRunAt(lane, from = new Date(), tickMinute = 3){
  if(!lane || !lane.enabled) return null;
  const first = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(),
    from.getUTCDate(), from.getUTCHours(), tickMinute, 0, 0));
  if(first <= from) first.setUTCHours(first.getUTCHours() + 1);
  for(let i = 0; i < 14 * 24; i++){
    const t = new Date(first.getTime() + i * 3600000);
    if(lane.until && t >= new Date(lane.until)) return null;
    if(isDueAt(lane, t)) return t;
  }
  return null;
}

// ---- CLI (used by steward-focus.yml; handy for humans too) -----------------
//   due       → app lane names due at THIS tick, one per line, REPEATED once
//               per slice (a lane with slices:3 prints its app 3×, so the
//               dispatcher fires 3 independent improve runs for it)
//   due-jobs  → platform job names due at THIS tick (focus.json `jobs`)
//   next      → "name<TAB>iso-or-never" for every app lane AND job
const cmd = process.argv[2];
if(cmd){
  const f = JSON.parse(readFileSync(new URL('./focus.json', import.meta.url), 'utf8'));
  const now = new Date();
  if(cmd === 'due'){
    for(const [app, lane] of Object.entries(f.apps || {})) if(isDueAt(lane, now))
      for(let i = 0; i < slicesOf(lane); i++) console.log(app);
  }else if(cmd === 'due-jobs'){
    for(const [job, lane] of Object.entries(f.jobs || {})) if(isDueAt(lane, now)) console.log(job);
  }else if(cmd === 'next'){
    for(const [app, lane] of Object.entries(f.apps || {})) console.log(`${app}\t${nextRunAt(lane, now)?.toISOString() || 'never'}`);
    for(const [job, lane] of Object.entries(f.jobs || {})) console.log(`job:${job}\t${nextRunAt(lane, now)?.toISOString() || 'never'}`);
  }else{
    console.error('usage: schedule.mjs due|due-jobs|next'); process.exit(2);
  }
}
