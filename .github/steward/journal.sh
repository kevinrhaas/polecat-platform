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
#
# THE JOURNAL ROLLS OVER, AND IT NEVER FAILS A RUN (2026-09-27). GitHub refuses
# a comment on an issue that already carries 2,500 ("Commenting is disabled on
# issues with more than 2500 comments", HTTP 403). The first journal, #56, hit
# that on 2026-09-27 at 12:27Z, and from then on every janitor run went red on
# this step alone — its sweep had finished and merged what it could — while
# the improve runs, which mark this step continue-on-error, stayed green and
# silently lost every entry, so Manager's run review read nothing new. So:
#   * before posting, the issue's comment count is read, and at
#     JOURNAL_ROLL_AT (2,400, leaving slack for runs racing the same count) a
#     NEW journal issue is opened, pointing back at the old one, and the old one
#     is closed. Manager reads the NEWEST steward-journal issue, open or closed
#     (github.js, state=all&per_page=1), so it follows the roll unchanged;
#   * a post refused for the cap anyway (the count read failed, or a burst of
#     runs crossed it together) rolls and retries once;
#   * any other failure to post is a WARNING and exit 0. The journal is the
#     run's write-up, never its verdict: it must not turn a run red.
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
seed_journal() {   # $1 = the full journal this one continues, or empty
  {
    echo "Every steward run posts a comment here saying what it actually did — Manager's Fleet Ops reads this journal for its in-panel run reviews. Keep this issue open."
    if [ -n "${1:-}" ]; then
      echo; echo "Continues #$1, which reached GitHub's 2,500-comment limit and was closed by \`journal.sh\`."
    fi
  } > /tmp/journal-seed.md
  bash "$GHREST" issue-create "$REPO" "Steward journal" /tmp/journal-seed.md steward-journal
}
roll_journal() {  # open the successor FIRST, then close the full one — never zero open
  local old="$1" new
  if ! new=$(seed_journal "$old") || [ -z "$new" ]; then
    echo "warning: could not open a successor to full journal #$old — skipping this entry" >&2
    return 1
  fi
  bash "$GHREST" issue-close "$REPO" "$old" || echo "warning: opened #$new but could not close full journal #$old" >&2
  echo "journal #$old is full — rolled over to #$new" >&2
  JR="$new"
}
if [ -z "$JR" ]; then
  JR=$(seed_journal "")
fi
ROLL_AT="${JOURNAL_ROLL_AT:-2400}"
COUNT=$(bash "$GHREST" issue-comments "$REPO" "$JR" 2>/dev/null || true)
if [[ "$COUNT" =~ ^[0-9]+$ ]] && [ "$COUNT" -ge "$ROLL_AT" ]; then
  roll_journal "$JR" || exit 0
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
# claim-notice.sh may already have posted a comment carrying this run's marker
# when it claimed its ticket, so that Fleet Ops could show the ticket while the
# run was still going. Replace that one rather than adding a second: two
# comments per run would double the journal, and `journalFor` takes the NEWEST
# match, so a stale "in progress" line surviving next to the real summary is
# only ever confusing. Falls back to posting when there is nothing to replace —
# the claim notice is best-effort and may never have run.
CID="$(bash "$GHREST" comment-find "$REPO" "$JR" "steward-run:${RUN_ID}" 2>/dev/null || true)"
if [ -n "$CID" ] && bash "$GHREST" comment-update "$REPO" "$CID" /tmp/journal-body.md 2>/dev/null; then
  echo "journaled run ${RUN_ID} → issue #${JR} (replaced the claim notice, comment ${CID})"
  exit 0
fi
post() { bash "$GHREST" issue-comment "$REPO" "$JR" /tmp/journal-body.md 2>/tmp/journal-post-err.txt; }
if ! post; then
  if grep -qi 'more than 2500 comments' /tmp/journal-post-err.txt && roll_journal "$JR" && post; then
    :
  else
    echo "warning: journal entry for run ${RUN_ID} was not posted — the run's verdict is unaffected" >&2
    cat /tmp/journal-post-err.txt >&2
    exit 0
  fi
fi
echo "journaled run ${RUN_ID} → issue #${JR}"
