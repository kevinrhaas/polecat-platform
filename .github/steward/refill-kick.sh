#!/usr/bin/env bash
# refill-kick.sh — the last step of a steward-improve run: decide whether this
# run's ending should kick steward-focus to refill its slot, and kick if so.
#
#   refill-kick.sh <job.status> <job start, epoch seconds> <cap minutes>
#
#   success                       → kick.
#   cancelled, at the job's cap   → kick. The cap is the ceiling, not a fault.
#   cancelled, short of the cap   → no kick: somebody pressed Cancel.
#   failure (or anything else)    → no kick; the */10 cron refills it.
#
# WHY CANCELLED-AT-THE-CAP KICKS (T-1711, 2026-09-27). Run 36364699185 (chicago
# [1/4]) had its PR open at 03:18Z and was cancelled at the 150-minute
# `timeout-minutes` at 03:36Z. This step was gated on `success`, so it was
# skipped, and the slot waited on cron ticks that were landing 20-40 minutes
# apart. The lane ran a slot short until the owner noticed at 03:40Z and
# dispatched steward-focus by hand.
#
# WHY THE KICK NAMES THIS RUN (T-2153, 2026-10-10). Seven runs were cancelled
# at the cap between 2026-10-08 and 2026-10-10. Six kicks refilled the slot:
# five in 12-16 s, one in 3m24s because its steward-focus run queued behind
# another. One did not. The scheduler read the run list 6 s before the kicking
# job finished tearing down, counted the slot as busy, and dispatched nothing.
# The other six won the same race by 2-5 s. So the kick now passes
# `freed_run=<this run id>`, and dispatch-lanes.mjs does not count that run.
#
# WHY A FAILURE STILL DOES NOT. An unconditional re-dispatch let a week of
# failing analytics runs burn the fleet's shared quota (tech-sweep issue #106).
# A run that hits the cap is not that loop: every cancellation measured so far
# was the ceiling, on runs that were doing real work.
#
# WHY A HAND CANCEL DOES NOT. Nobody should press Cancel and have the lane put
# the run straight back. Concurrency supersedes are not a third case: the group
# runs with `cancel-in-progress: false`, so a running job is never superseded.
# A pending run that gets dropped never reaches this step at all. That leaves
# hand cancels, and they are told apart by elapsed time: within MARGIN minutes
# of the cap counts as the cap. Turning a lane off is a separate thing, and the
# scheduler already refuses it: `isDueAt` returns false for a lane whose
# `enabled` is off (schedule.mjs), so a kick for a stopped lane dispatches
# nothing.
#
# A redundant kick is harmless. The scheduler fills only the empty slots it
# finds, so one with nothing to do dispatches nothing.
#
# Env: REFILL_NOW (epoch seconds, tests only), REFILL_MARGIN_MINUTES (default 10),
# REFILL_REPO (default kevinrhaas/polecat-platform).
set -uo pipefail
status="${1:-}"; started="${2:-}"; cap="${3:-}"
now="${REFILL_NOW:-$(date +%s)}"
margin="${REFILL_MARGIN_MINUTES:-10}"
repo="${REFILL_REPO:-kevinrhaas/polecat-platform}"

# The run doing the kicking is still `in_progress` while it kicks, and stays so
# through its post-job cleanup, so the scheduler would count its slot as busy.
# Naming it lets the scheduler free that one slot (T-2153: 37807547340's kick
# read occupancy at 18:47:47Z, the job ended at 18:47:53Z, nothing was
# dispatched, and the slot waited 2 minutes for a cron tick).
run_id="${GITHUB_RUN_ID:-}"
kick() {
  echo "→ $1; kicking steward-focus to refill the slot"
  if [[ "$run_id" =~ ^[0-9]+$ ]]; then
    gh workflow run steward-focus.yml -R "$repo" -f freed_run="$run_id"
  else
    gh workflow run steward-focus.yml -R "$repo"
  fi
}

case "$status" in
  success)
    kick "slot freed" ;;
  cancelled)
    if ! [[ "$started" =~ ^[0-9]+$ && "$cap" =~ ^[0-9]+$ ]]; then
      echo "→ cancelled, but there is no job-start stamp or cap to measure against (start='$started' cap='$cap'); not kicking — the cron refills it"
      exit 0
    fi
    elapsed=$(( (now - started) / 60 ))
    if (( elapsed >= cap - margin )); then
      kick "cancelled at ${elapsed}m, the ${cap}m cap"
    else
      echo "→ cancelled at ${elapsed}m, short of the ${cap}m cap: a hand cancel, not the ceiling; not kicking — the cron decides"
    fi ;;
  *)
    echo "→ run ended '${status}'; not kicking — the cron refills a failed slot (tech-sweep #106)" ;;
esac
