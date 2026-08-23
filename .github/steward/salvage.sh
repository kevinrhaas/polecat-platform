#!/usr/bin/env bash
# salvage.sh — never let a cancelled run take its work with it.
#
#   salvage.sh <run-id> <job-status>
#
# WHY THIS EXISTS. A steward run does its work in clones under $GITHUB_WORKSPACE
# and the runner is destroyed when the job ends. A run cancelled at the timeout
# cap therefore loses EVERYTHING it had not already pushed — improve run #977
# (custom lane, 2026-08-23) burned 149 minutes and left no commit, no branch and
# no journal entry, so there was nothing to resume from and nothing to learn
# from. See polecat-platform issue #139.
#
# WHAT IT DOES, for the workspace repo and every clone beside it:
#   1. Reports the tree: branch, dirty files, commits not on the remote. This
#      runs on EVERY outcome, including success — a run that shipped but left
#      something behind is worth seeing too.
#   2. Pushes any branch holding commits the remote does not have. Safe by
#      construction: default branches are refused outright, so this can only
#      ever complete a push the run itself intended to make.
#   3. Only when the job did NOT succeed, and only if the tree is dirty, commits
#      the leftovers to a SEPARATE branch `steward/salvage/<run-id>` and pushes
#      that. Deliberately not the working branch: half-finished work must be
#      recoverable without being mistaken for work the run meant to ship, and a
#      later run must never build on top of it by accident.
#
# Every step is best-effort. Salvage failing must not colour the run's status.
set -u

RUN_ID="${1:-unknown}"
STATUS="${2:-unknown}"
WS="${GITHUB_WORKSPACE:-$PWD}"

echo "── salvage · run ${RUN_ID} · job status: ${STATUS}"

# The workspace repo plus each clone directly inside it. `improve.md` tells the
# agent to clone INSIDE the workspace (so playwright resolves), so one level is
# the whole story.
repos=("$WS")
for d in "$WS"/*/; do
  [ -e "${d}.git" ] && repos+=("${d%/}")
done

salvaged=0

# run <cmd…> — echo the command's output indented, and return ITS exit code.
# `cmd | sed` would report sed's status instead, and a push that silently
# "succeeded" because sed exited 0 is exactly the lie this script exists to
# stop telling.
run () {
  local out rc
  out=$("$@" 2>&1); rc=$?
  [ -n "$out" ] && printf '%s\n' "$out" | sed 's/^/    /'
  return $rc
}

for repo in "${repos[@]}"; do
  name=$(basename "$repo")
  branch=$(git -C "$repo" rev-parse --abbrev-ref HEAD 2>/dev/null) || continue
  echo
  echo "· ${name} @ ${branch}"

  # --- what is here ------------------------------------------------------
  dirty=$(git -C "$repo" status --porcelain 2>/dev/null)
  if [ -n "$dirty" ]; then
    n=$(printf '%s\n' "$dirty" | wc -l | tr -d ' ')
    echo "  ${n} uncommitted path(s):"
    printf '%s\n' "$dirty" | head -40 | sed 's/^/    /'
    [ "$n" -gt 40 ] && echo "    … $((n - 40)) more"
  else
    echo "  working tree clean"
  fi

  case "$branch" in
    main|master|dev|stage|HEAD)
      echo "  default branch — nothing to push from here"
      continue
      ;;
  esac

  # --- commits the remote has never seen ---------------------------------
  # Against ALL remote-tracking refs, not `origin/<branch>..HEAD`: the usual
  # case is a branch the run created and never pushed, where origin/<branch>
  # does not exist and the two-dot form has nothing to subtract — it would
  # report the repo's whole history as unpushed.
  git -C "$repo" fetch origin "$branch" --quiet 2>/dev/null
  ahead=$(git -C "$repo" rev-list --count HEAD --not --remotes 2>/dev/null || echo 0)
  if [ "${ahead:-0}" -gt 0 ]; then
    echo "  ${ahead} commit(s) not on origin — pushing ${branch}"
    if run git -C "$repo" push -u origin "$branch"; then
      salvaged=$((salvaged + 1))
    else
      echo "::warning::salvage could not push ${name}:${branch}"
    fi
  else
    echo "  no unpushed commits"
  fi

  # --- leftovers, only when the run did not finish -------------------------
  [ "$STATUS" = "success" ] && continue
  [ -z "$dirty" ] && continue

  salvage_branch="steward/salvage/${RUN_ID}"
  echo "  run did not succeed and the tree is dirty — parking leftovers on ${salvage_branch}"
  # The repo's own .gitignore applies. At the workspace root the app clones are
  # nested repos: exclude them explicitly rather than committing gitlinks.
  excludes=()
  if [ "$repo" = "$WS" ]; then
    for d in "$WS"/*/; do
      [ -e "${d}.git" ] && excludes+=(":(exclude)$(basename "${d%/}")")
    done
  fi

  if run git -C "$repo" checkout -b "$salvage_branch" \
     && run git -C "$repo" add -A -- . "${excludes[@]+"${excludes[@]}"}" \
     && run git -C "$repo" commit -q --no-verify \
          -m "steward: salvage from cancelled run ${RUN_ID}" \
          -m "Work in progress rescued from a run that ended as '${STATUS}' before it could ship. NOT reviewed, NOT gated, and NOT a branch to build on — read it, take what is useful, delete it." \
          -m "Co-authored-by: polecat-steward <steward@polecat.live>" \
     && run git -C "$repo" push -u origin "$salvage_branch"; then
    salvaged=$((salvaged + 1))
  else
    echo "::warning::salvage could not park ${name}'s leftovers"
  fi
done

echo
if [ "$salvaged" -gt 0 ]; then
  echo "── salvage pushed ${salvaged} branch(es)"
else
  echo "── salvage found nothing unpushed"
fi
exit 0
