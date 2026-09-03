#!/usr/bin/env bash
# journal.sh — post a steward run's summary to the "Steward journal" issue.
#
#   journal.sh <run-id> <title> <status> [summary-file] [--whole]
#
# Every steward workflow calls this (if: always()) after its run step, passing
# the captured stdout of the run (for Claude-driven jobs that's the final
# summary the prompt asks for; for the janitor it's the action list). The
# journal is a single always-open issue labeled `steward-journal` in
# polecat-platform — API-readable, so Manager's Fleet Ops shows each run's
# narrative in its in-panel run review by matching the
# `<!-- steward-run:ID -->` marker. Comments are capped at ~4KB of tail —
# EXCEPT with `--whole`, which posts the file as given (to 12KB). The improve
# workflow passes a body whose first lines are the machine-readable run record;
# tailing that would cut off the very header the entry exists for.
set -e
RUN_ID="$1"; TITLE="$2"; STATUS="$3"; FILE="${4:-}"; MODE="${5:-tail}"
REPO="kevinrhaas/polecat-platform"
GHREST="$(cd "$(dirname "$0")" && pwd)/gh-rest.sh"
# Every call here goes through gh-rest.sh: REST rather than GraphQL, and RETRIED
# on a rate limit. The lookup was already on REST for the first reason — and on
# 2026-08-27 it failed anyway, on a SECONDARY limit, thirty-seven seconds after
# core read 5000/5000 remaining. Picking the right bucket was never going to be
# enough on its own; see gh-rest.sh's header for both measurements.
bash "$GHREST" label-create "$REPO" steward-journal 1f6feb "The steward's run journal"
# Distinguish "API call failed" (skip entirely — do NOT fall through to minting
# a duplicate journal issue) from "call succeeded, no open issue exists yet"
# (create one, as before).
if ! JR=$(bash "$GHREST" issue-find "$REPO" steward-journal 2>/tmp/journal-lookup-err.txt); then
  echo "warning: steward-journal lookup failed after retries — skipping journal entry, not creating a duplicate issue" >&2
  cat /tmp/journal-lookup-err.txt >&2
  exit 0
fi
if [ -z "$JR" ]; then
  cat > /tmp/journal-seed.md <<'SEED'
Every steward run posts a comment here saying what it actually did — Manager's Fleet Ops reads this journal for its in-panel run reviews. Keep this issue open.
SEED
  JR=$(bash "$GHREST" issue-create "$REPO" "Steward journal" /tmp/journal-seed.md steward-journal)
fi
{
  echo "<!-- steward-run:${RUN_ID} -->"
  echo "### ${TITLE} · ${STATUS}"
  echo
  if [ -n "$FILE" ] && [ -s "$FILE" ]; then
    if [ "$MODE" = "--whole" ]; then head -c 12000 "$FILE"; else tail -c 4000 "$FILE"; fi
  else echo "_(no summary captured)_"; fi
  echo
  echo "[Run log](https://github.com/${REPO}/actions/runs/${RUN_ID})"
} > /tmp/journal-body.md
bash "$GHREST" issue-comment "$REPO" "$JR" /tmp/journal-body.md
echo "journaled run ${RUN_ID} → issue #${JR}"
