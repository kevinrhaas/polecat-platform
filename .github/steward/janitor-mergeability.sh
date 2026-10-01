#!/usr/bin/env bash
# janitor-mergeability.sh — put the MERGE RESULT on disk, or name the conflict.
#
# Why this exists (T-0809, kevinrhaas/custom): the janitor used to
# `git clone --depth 1 -b "$BR"` and gate the branch AS IT STANDS, never merged
# with the base it was about to be merged into. Two faults fell out of that, both
# measured on 2026-09-05 when 21 automation PRs had silted up:
#
#   1. a green branch was merged WITHOUT the merge ever having been gated — the
#      same hole T-0674 filed against bot-opened PRs;
#   2. when the server-side merge then failed on conflict, the janitor printed
#      "merge failed (conflict?)" and moved on. No comment, no label, nothing.
#      Each of those PRs was swept, silently skipped, and swept again next hour.
#
# So the merge is now done FIRST, locally, and it is the merge that gets gated.
# A conflict is discovered here — before a gate is spent on it — and the
# conflicting paths come back by name so the janitor can say them out loud.
#
#   prepare <clone-url> <dir> <base> <head>
#       exit 0  → prints "MERGED <sha>"; <dir> holds base+head merged, gate it
#       exit 1  → prints "CONFLICT" then one conflicting path per line
#       exit 2  → prints "UNKNOWN <reason>"; the sweep should skip, not guess
#   --self-test
#       builds real git repos with a real conflict and asserts all three
#
# Shallow on purpose. kevinrhaas/custom is a 3.2 GB monorepo and seven bake legs
# have already died on a full checkout of it (T-0437), so both tips arrive at
# JANITOR_FETCH_DEPTH (default 200) and the depth is only doubled if that failed
# to reach a common ancestor. A steward branch is hours old; 200 is generous.
set -uo pipefail

DEPTH="${JANITOR_FETCH_DEPTH:-200}"

prepare() {
  local url="$1" dir="$2" base="$3" head="$4"

  git init -q "$dir" 2>/dev/null || { echo "UNKNOWN git init failed"; return 2; }
  git -C "$dir" remote add origin "$url" || { echo "UNKNOWN remote add failed"; return 2; }
  # Identity is required for `git merge` to write a commit, and this clone is a
  # scratch directory that is deleted before the sweep moves on.
  git -C "$dir" config user.email 'steward@polecat.live'
  git -C "$dir" config user.name 'Steward janitor'

  if ! _fetch "$dir" --depth "$DEPTH" "$base" "$head"; then
    echo "UNKNOWN fetch of $base/$head failed"; return 2
  fi
  if ! git -C "$dir" checkout -q -B janitor-gate "refs/remotes/origin/$base" 2>/dev/null; then
    echo "UNKNOWN cannot check out base $base"; return 2
  fi

  local err
  err="$(git -C "$dir" merge --no-edit --no-ff "refs/remotes/origin/$head" 2>&1)"
  if [ $? -eq 0 ]; then
    echo "MERGED $(git -C "$dir" rev-parse HEAD)"; return 0
  fi

  local conflicts
  conflicts="$(git -C "$dir" diff --name-only --diff-filter=U 2>/dev/null)"
  if [ -n "$conflicts" ]; then
    echo "CONFLICT"; printf '%s\n' "$conflicts"; return 1
  fi

  # No unmerged paths means this was not a content conflict. Overwhelmingly that
  # is "refusing to merge unrelated histories": the two shallow tips never met.
  # Deepen once and try again before reporting anything.
  git -C "$dir" merge --abort 2>/dev/null
  if ! _fetch "$dir" --deepen "$DEPTH" "$base" "$head"; then
    echo "UNKNOWN deepen failed after: $(_oneline "$err")"; return 2
  fi
  git -C "$dir" checkout -q -B janitor-gate "refs/remotes/origin/$base" 2>/dev/null

  err="$(git -C "$dir" merge --no-edit --no-ff "refs/remotes/origin/$head" 2>&1)"
  if [ $? -eq 0 ]; then
    echo "MERGED $(git -C "$dir" rev-parse HEAD)"; return 0
  fi
  conflicts="$(git -C "$dir" diff --name-only --diff-filter=U 2>/dev/null)"
  if [ -n "$conflicts" ]; then
    echo "CONFLICT"; printf '%s\n' "$conflicts"; return 1
  fi
  git -C "$dir" merge --abort 2>/dev/null
  echo "UNKNOWN merge failed with no unmerged paths: $(_oneline "$err")"; return 2
}

# One fetch, two explicit refspecs. FETCH_HEAD would only name the last ref, and
# the whole job here is to hold both tips at once.
_fetch() {
  local dir="$1" flag="$2" n="$3" base="$4" head="$5"
  git -C "$dir" fetch -q "$flag" "$n" origin \
    "+refs/heads/${base}:refs/remotes/origin/${base}" \
    "+refs/heads/${head}:refs/remotes/origin/${head}" 2>/dev/null
}

_oneline() { printf '%s' "$1" | tr '\n' ' ' | cut -c1-200; }

self_test() {
  local tmp; tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' RETURN
  local pass=0 fail=0
  ok()  { printf '  \033[32mok\033[0m    %s\n' "$1"; pass=$((pass+1)); }
  bad() { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; fail=$((fail+1)); }
  chk() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 — expected [$3], got [$2]"; fi; }

  # An origin with a base branch, a branch that merges cleanly, and a branch
  # that collides with the base on one file. Real commits, real git, no fakes:
  # the fault this guards against was git behaviour nobody had exercised.
  local origin="$tmp/origin"
  git init -q -b main "$origin"
  git -C "$origin" config user.email a@b.c; git -C "$origin" config user.name T
  printf 'one\n' > "$origin/shared.txt"; printf 'untouched\n' > "$origin/other.txt"
  git -C "$origin" add -A; git -C "$origin" commit -qm root

  git -C "$origin" checkout -q -b clean
  printf 'new file\n' > "$origin/added.txt"
  git -C "$origin" add -A; git -C "$origin" commit -qm 'clean: add a file'

  git -C "$origin" checkout -q -b collides main
  printf 'branch version\n' > "$origin/shared.txt"
  printf 'also mine\n' > "$origin/second.txt"
  git -C "$origin" add -A; git -C "$origin" commit -qm 'collides: rewrite shared.txt'

  # …and the base moves after both branched, which is what actually creates the
  # conflict: `collides` was fine when it was opened.
  git -C "$origin" checkout -q main
  printf 'base version\n' > "$origin/shared.txt"
  printf 'base too\n' > "$origin/second.txt"
  git -C "$origin" add -A; git -C "$origin" commit -qm 'main: rewrite shared.txt'

  echo "janitor-mergeability.sh — the merge is gated, the conflict is named"

  local out rc
  out="$(prepare "$origin" "$tmp/c1" main clean)"; rc=$?
  chk "a clean branch reports MERGED"            "$rc" "0"
  chk "…and says so in a parseable first word"   "$(echo "$out" | head -1 | cut -d' ' -f1)" "MERGED"
  chk "…and the dir holds the MERGE, not the branch (base's change is present)" \
      "$(cat "$tmp/c1/shared.txt" 2>/dev/null)" "base version"
  chk "…with the branch's change present too"    "$(cat "$tmp/c1/added.txt" 2>/dev/null)" "new file"

  out="$(prepare "$origin" "$tmp/c2" main collides)"; rc=$?
  chk "a conflicting branch reports CONFLICT"     "$rc" "1"
  chk "…and names every conflicting path, sorted" \
      "$(echo "$out" | tail -n +2 | sort | tr '\n' ',')" "second.txt,shared.txt,"
  chk "…and does NOT name files neither side touched" \
      "$(echo "$out" | grep -c 'other.txt')" "0"

  out="$(prepare "$origin" "$tmp/c3" main no-such-branch)"; rc=$?
  chk "a missing branch is UNKNOWN, never a conflict" "$rc" "2"
  chk "…and says which fetch failed" "$(echo "$out" | grep -c 'no-such-branch')" "1"

  # Unrelated histories at the fetched depth: DEPTH=1 cannot reach the common
  # root, so the first merge fails with no unmerged paths and the deepen must
  # rescue it. This is the case that made a local merge look unusable.
  out="$(JANITOR_FETCH_DEPTH=1 prepare "$origin" "$tmp/c4" main clean)"; rc=$?
  chk "a depth too shallow to reach a common ancestor is deepened, not guessed" "$rc" "0"
  chk "…and still lands the merge result" "$(cat "$tmp/c4/shared.txt" 2>/dev/null)" "base version"

  printf '\n%s passed, %s failed\n' "$pass" "$fail"
  [ "$fail" -eq 0 ]
}

case "${1:-}" in
  prepare)     shift; prepare "$@" ;;
  --self-test) self_test ;;
  *) sed -n '/^#   prepare/,/^#       builds real/p' "$0" >&2; exit 64 ;;
esac
