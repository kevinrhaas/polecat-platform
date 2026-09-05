#!/usr/bin/env bash
# claim-notice.sh — say which ticket this run is working, the moment it knows.
#
#   claim-notice.sh <slice> <slices> <ticket-id> <title…>
#
# WHY. A batch of N slices is anonymous while it runs. The Actions list shows
# "Steward improve — custom [3/8]" and an elapsed time; Manager's Fleet Ops
# shows the same runs and, when one finishes, its journal entry. Neither can say
# WHICH TICKET a running slice took, because the run name is fixed at dispatch
# and the journal is written at the end. So the only way to answer "what is
# slice 3 doing" was to wait ~30 minutes for it to push a branch and read the
# branch name — and with 8 slices in flight that is the question you actually
# have. Reported by Kevin, 2026-08-27.
#
# The run knows at claim time. This writes it into the two places that are
# already being read, and costs one REST call:
#
#   1. $GITHUB_STEP_SUMMARY and a ::notice:: annotation — the Actions run page
#      shows both without anyone fetching anything.
#   2. A journal comment carrying this run's `<!-- steward-run:ID -->` marker.
#      Fleet Ops already looks that marker up per run (github.js journalFor),
#      NEWEST comment first — so this shows while the run is in flight, and
#      journal.sh supersedes it at the end by UPDATING this same comment rather
#      than adding a second one. No Manager change is needed for either.
#
# Best-effort throughout: a run must never die because it could not announce
# itself. Every failure path exits 0.
set -uo pipefail
SLICE="${1:-?}"; SLICES="${2:-?}"; TICKET="${3:-}"; shift 3 2>/dev/null || true
TITLE="${*:-}"
REPO="kevinrhaas/polecat-platform"
GHREST="$(cd "$(dirname "$0")" && pwd)/gh-rest.sh"
RUN_ID="${GITHUB_RUN_ID:-}"
APP="${FOCUS_APP:-fleet}"

[ -n "$TICKET" ] || { echo "claim-notice: no ticket id given; nothing to announce" >&2; exit 0; }

LINE="slice ${SLICE}/${SLICES} · ${APP} · ${TICKET}"
[ -n "$TITLE" ] && LINE="${LINE} — ${TITLE}"

# 1. The run's own page. Free, and visible the moment the step ends.
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  { echo "### ${TICKET}"; echo; echo "**${LINE}**"; echo; } >> "$GITHUB_STEP_SUMMARY" || true
fi
echo "::notice title=${TICKET}::${LINE}"

# 2. The journal, so Fleet Ops can show it live. Skipped rather than failed when
#    the journal issue is not reachable — the annotation above already carries
#    the information, and losing the comment must not cost the unit of work.
[ -n "$RUN_ID" ] || { echo "claim-notice: no GITHUB_RUN_ID; annotation only" >&2; exit 0; }
JR="$(bash "$GHREST" issue-find "$REPO" steward-journal 2>/dev/null || true)"
[ -n "$JR" ] || { echo "claim-notice: no steward-journal issue; annotation only" >&2; exit 0; }

{
  echo "<!-- steward-run:${RUN_ID} -->"
  echo "### ${APP} · slice ${SLICE} of ${SLICES} · **${TICKET}** — in progress"
  echo
  [ -n "$TITLE" ] && { echo "${TITLE}"; echo; }
  echo "_Claimed $(date -u '+%Y-%m-%d %H:%M') UTC. This comment is replaced by the run's summary when it finishes._"
  echo
  echo "[Run log](https://github.com/${REPO}/actions/runs/${RUN_ID})"
} > /tmp/claim-notice.md

bash "$GHREST" issue-comment "$REPO" "$JR" /tmp/claim-notice.md 2>/dev/null \
  && echo "claim-notice: announced ${TICKET} on journal #${JR}" \
  || echo "claim-notice: journal comment failed; annotation only" >&2
exit 0
