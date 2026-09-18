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
#   3. Opens a DRAFT pull request for any working branch it pushed that has none.
#      A pushed branch nobody can see is the fault this step exists to prevent and
#      did not: on 2026-09-17 a run wrote the whole of custom's T-1155, pushed it,
#      and was cancelled before it opened a PR. The branch was on the remote and
#      complete; the ticket still read `open`, `ticket.mjs landed` looks for a
#      merged PR and found none, and `inflight` filed the branch under "finished,
#      or litter". The claim went stale at three hours, another run stole it, and
#      rebuilt the same 71-file fix. A draft PR costs one REST call and makes the
#      work impossible to miss, while saying plainly that it is not reviewed.
#   4. Only when the job did NOT succeed, and only if the tree is dirty, commits
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

GH_REST="${GH_REST:-$(dirname "$0")/gh-rest.sh}"

# The owner/repo slug for a clone, read off its origin URL. Empty when there is no
# origin, or it is not a GitHub remote — in which case there is no PR to open.
slug_of () {
  local url
  # The RAW configured url, not `remote get-url`, which applies any `insteadOf`
  # rewrite a runner has configured and would hand back whatever that points at.
  url=$(git -C "$1" config --get remote.origin.url 2>/dev/null) || return 1
  case "$url" in
    *github.com[:/]*) printf '%s\n' "${url##*github.com[:/]}" | sed 's/\.git$//' ;;
    *) return 1 ;;
  esac
}

# Where a pull request from this clone should go. `dev` when the repo HAS one —
# every app on the two-tier pipeline takes its work there and never into main —
# otherwise the remote's default branch. Never the branch we are on.
base_of () {
  if git -C "$1" ls-remote --exit-code --heads origin dev >/dev/null 2>&1; then
    printf 'dev\n'; return
  fi
  local head
  head=$(git -C "$1" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null)
  printf '%s\n' "${head##*/}"
}

# A DRAFT PULL REQUEST FOR WORK NOBODY CAN SEE — step 3 of the contract above.
# Best-effort in every direction: no slug, no base, an existing PR, or a REST
# refusal all end in a note and exit 0. Salvage must never colour the run.
open_draft_pr () {
  local repo="$1" branch="$2" name="$3" base slug existing body title
  slug=$(slug_of "$repo") || { echo "  no github origin — no draft PR to open"; return 0; }
  base=$(base_of "$repo")
  [ -n "$base" ] || { echo "  cannot tell which branch to target — no draft PR opened"; return 0; }
  [ "$base" = "$branch" ] && return 0
  if [ ! -x "$GH_REST" ]; then echo "  gh-rest.sh not found at ${GH_REST} — no draft PR opened"; return 0; fi

  # Did this branch EVER have one? An open PR is already visible, and a closed or
  # merged one means the branch was never invisible, which is the only fault here.
  existing=$(bash "$GH_REST" pr-find "$slug" "$branch" all 2>/dev/null || true)
  if [ -n "$existing" ]; then echo "  ${slug}#${existing} already carries ${branch} — nothing to open"; return 0; fi

  title="WIP: ${branch} — rescued from run ${RUN_ID}"
  body="$(mktemp)"
  cat > "$body" <<EOF
**This pull request was opened by salvage, not by the run that did the work.**

Run \`${RUN_ID}\` ended as \`${STATUS}\` with commits pushed to \`${branch}\` and no pull
request of its own. It is opened as a **draft** so the work is visible instead of sitting on the
remote where nothing can find it, and it is **not reviewed, not gated and not ready to merge**.

Whoever picks this up: read the branch, run the repo's own gate, and either finish this pull
request or take what is useful and close it. If it carries a ticket number, that ticket is still
open and the queue is still offering it, so the next run will rebuild this work unless somebody
reads it first.

Run log: https://github.com/kevinrhaas/polecat-platform/actions/runs/${RUN_ID}
EOF
  local number
  number=$(bash "$GH_REST" pr-create "$slug" "$branch" "$base" "$title" "$body" draft 2>&1) || {
    echo "::warning::salvage could not open a draft PR for ${name}:${branch}"
    printf '%s\n' "$number" | sed 's/^/    /'; rm -f "$body"; return 0; }
  rm -f "$body"
  echo "  draft PR ${slug}#${number} opened for ${branch} → ${base}"
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
      open_draft_pr "$repo" "$branch" "$name"
    else
      echo "::warning::salvage could not push ${name}:${branch}"
    fi
  else
    echo "  no unpushed commits"
    # …which is not the same as "nothing to see". A run cancelled AFTER its last push
    # and before its PR leaves exactly this: a branch the remote already has, carrying
    # an unfinished ticket, with nothing pointing at it. That is T-1155 precisely.
    if [ "$STATUS" != "success" ] && git -C "$repo" rev-parse --verify --quiet "origin/${branch}" >/dev/null 2>&1; then
      open_draft_pr "$repo" "$branch" "$name"
    fi
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
