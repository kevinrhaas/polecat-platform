#!/usr/bin/env bash
# journal.sh — post a steward run's summary to the "Steward journal" issue.
#
#   journal.sh <run-id> <title> <status> [summary-file]
#
# Every steward workflow calls this (if: always()) after its run step, passing
# the captured stdout of the run (for Claude-driven jobs that's the final
# summary the prompt asks for; for the janitor it's the action list). The
# journal is a single always-open issue labeled `steward-journal` in
# polecat-platform — API-readable, so Manager's Fleet Ops shows each run's
# narrative in its in-panel run review by matching the
# `<!-- steward-run:ID -->` marker. Comments are capped at ~4KB of tail.
set -e
RUN_ID="$1"; TITLE="$2"; STATUS="$3"; FILE="${4:-}"
REPO="kevinrhaas/polecat-platform"
gh label create steward-journal -R "$REPO" --description "The steward's run journal" --color 1f6feb --force >/dev/null 2>&1 || true
# REST, not `gh issue list` (GraphQL): the GraphQL quota is shared fleet-wide
# and can be exhausted by unrelated runs. Distinguish "API call failed" (skip
# entirely — do NOT fall through to minting a duplicate journal issue) from
# "call succeeded, no open issue exists yet" (create one, as before).
if ! JR=$(gh api "repos/${REPO}/issues?state=open&labels=steward-journal&per_page=1" --jq '.[0].number // empty' 2>/tmp/journal-lookup-err.txt); then
  echo "warning: steward-journal lookup failed (rate limit or API error) — skipping journal entry, not creating a duplicate issue" >&2
  cat /tmp/journal-lookup-err.txt >&2
  exit 0
fi
if [ -z "$JR" ]; then
  JR=$(gh issue create -R "$REPO" --title "Steward journal" --label steward-journal \
    --body "Every steward run posts a comment here saying what it actually did — Manager's Fleet Ops reads this journal for its in-panel run reviews. Keep this issue open." \
    | grep -oE '[0-9]+$')
fi
{
  echo "<!-- steward-run:${RUN_ID} -->"
  echo "### ${TITLE} · ${STATUS}"
  echo
  if [ -n "$FILE" ] && [ -s "$FILE" ]; then tail -c 4000 "$FILE"; else echo "_(no summary captured)_"; fi
  echo
  echo "[Run log](https://github.com/${REPO}/actions/runs/${RUN_ID})"
} > /tmp/journal-body.md
gh issue comment "$JR" -R "$REPO" --body-file /tmp/journal-body.md >/dev/null
echo "journaled run ${RUN_ID} → issue #${JR}"
