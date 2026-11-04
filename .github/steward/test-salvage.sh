#!/usr/bin/env bash
# test-salvage.sh — salvage leaves nothing on the remote that nobody can see.
#
# WHY THIS EXISTS (custom T-1155, 2026-09-17). Salvage already pushed the branch of a
# cancelled run, and that was not enough. A run wrote the whole of a ticket's fix, pushed
# it, and was cancelled before it opened a pull request. The branch was on the remote and
# complete — and the ticket still read `open`, `ticket.mjs landed` looks for a MERGED pull
# request and found none, and `inflight` filed the branch under "finished, or litter". The
# claim went stale at three hours, another run stole it, and rebuilt the same 71-file fix.
#
# So the push is only half of the rescue: the other half is a DRAFT pull request, which
# costs one REST call and makes the work impossible to miss while saying plainly that it
# is neither reviewed nor gated. These cases drive the real script against a real git
# remote, with gh-rest.sh stubbed, because the fault was never in the git half.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SUT="$HERE/salvage.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
pass=0; fail=0
ok()   { printf '  \033[32mok\033[0m    %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; fail=$((fail+1)); }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 — expected [$3], got [$2]"; fi; }

export STUB_FIND="" STUB_NUMBER=99
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@e GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@e

# A stub gh-rest.sh: logs every call, and answers pr-find from $STUB_FIND.
mkstub() {
  cat > "$TMP/gh-rest.sh" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$STUB_CALLS"
case "${1:-}" in
  pr-find)   printf '%s\n' "${STUB_FIND:-}" ;;
  pr-create) printf '%s\n' "${STUB_NUMBER:-99}" ;;
esac
STUB
  chmod +x "$TMP/gh-rest.sh"
}
mkstub

# A fresh origin + clone. `dev` exists on the remote, so it is the base a PR must target.
newrepo() {
  local n="$1"
  rm -rf "$TMP/$n" "$TMP/$n.git"
  git init -q --bare "$TMP/$n.git"
  git clone -q "$TMP/$n.git" "$TMP/$n" 2>/dev/null
  # origin must LOOK like GitHub, because that is what salvage reads a slug off, and
  # still push to the bare repo beside it. `insteadOf` rewrites the transport only.
  git -C "$TMP/$n" config remote.origin.url "https://github.com/kevinrhaas/${n}.git"
  git -C "$TMP/$n" config "url.$TMP/$n.git.insteadOf" "https://github.com/kevinrhaas/${n}.git"
  git -C "$TMP/$n" commit -q --allow-empty -m base
  git -C "$TMP/$n" branch -M main
  git -C "$TMP/$n" push -q -u origin main
  git -C "$TMP/$n" push -q origin main:dev
  git -C "$TMP/$n" remote set-head origin main >/dev/null 2>&1
  git -C "$TMP/$n" fetch -q origin 2>/dev/null
  STUB_CALLS="$TMP/calls.$n"; : > "$STUB_CALLS"; export STUB_CALLS
}

runsalvage() {  # runsalvage <repo-dir> <status>
  FOCUS_APP="" TARGET_TICKET="" RESUME_PR="" GITHUB_WORKSPACE="$1" GH_REST="$TMP/gh-rest.sh" bash "$SUT" 12345 "$2" 2>&1
}
runnative() {  # the workflow's owner-targeted native Chicago context
  FOCUS_APP=chicago TARGET_TICKET=T-2420 RESUME_PR=1687 GITHUB_WORKSPACE="$1" GH_REST="$TMP/gh-rest.sh" bash "$SUT" 12345 "$2" 2>&1
}
archives() {
  git -C "$1" for-each-ref --format='%(refname:short)' refs/heads/steward/salvage/unqualified/
}
record_archives() {  # Exercise the real journal parser against actual salvage output.
  printf '%s\n' "$out" > "$TMP/salvage.txt"
  node "$HERE/run-record.mjs" --salvage "$TMP/salvage.txt" --json "$TMP/record.json" >/dev/null
  node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).salvaged_branches.join("\n"))' "$TMP/record.json"
}

echo "salvage.sh — nothing on the remote that nobody can see"

# ── 1. Unpushed work on a cancelled run: pushed, and given a draft PR ───────
newrepo a
git -C "$TMP/a" checkout -q -b steward/t-1155-brackets
echo x > "$TMP/a/f.txt"; git -C "$TMP/a" add -A; git -C "$TMP/a" commit -q -m "T-1155: the fix"
STUB_FIND=""; out=$(runsalvage "$TMP/a" cancelled)
check "the branch reaches the remote" \
  "$(git -C "$TMP/a.git" rev-parse --verify --quiet refs/heads/steward/t-1155-brackets >/dev/null && echo yes)" "yes"
if grep -q '^pr-create .* steward/t-1155-brackets dev .* draft$' "$TMP/calls.a"; then
  ok "…and a DRAFT pull request is opened for it, into dev"
else bad "no draft PR was opened — $(cat "$TMP/calls.a")"; fi
if grep -q '^pr-find .* steward/t-1155-brackets all$' "$TMP/calls.a"; then
  ok "…after asking whether the branch EVER had one, not just an open one"
else bad "pr-find was not asked with state=all — $(cat "$TMP/calls.a")"; fi

# ── 2. THE T-1155 CASE EXACTLY: already pushed, cancelled, and no PR ────────
# Nothing to push, so the old script did nothing at all and said "no unpushed
# commits" — which is true, and was never the question.
newrepo b
git -C "$TMP/b" checkout -q -b steward/t-1155-brackets
echo x > "$TMP/b/f.txt"; git -C "$TMP/b" add -A; git -C "$TMP/b" commit -q -m "T-1155: the fix"
git -C "$TMP/b" push -q -u origin steward/t-1155-brackets
: > "$TMP/calls.b"
STUB_FIND=""; out=$(runsalvage "$TMP/b" cancelled)
if grep -q '^pr-create .* draft$' "$TMP/calls.b"; then
  ok "a branch the remote already has still gets its draft PR when the run was cancelled"
else bad "the already-pushed branch was left invisible — $(cat "$TMP/calls.b")"; fi

# ── 3. A branch that already has a pull request is left alone ───────────────
newrepo c
git -C "$TMP/c" checkout -q -b steward/t-0042-thing
echo x > "$TMP/c/f.txt"; git -C "$TMP/c" add -A; git -C "$TMP/c" commit -q -m work
STUB_FIND="123"; out=$(runsalvage "$TMP/c" cancelled)
if grep -q '^pr-create' "$TMP/calls.c"; then
  bad "salvage opened a second PR for a branch that already had one"
else ok "a branch that already has a pull request is not given another"; fi
check "…and it says which one carries it" "$(grep -c '#123 already carries' <<<"$out")" "1"

# ── 4. A run that SUCCEEDED with nothing unpushed is not second-guessed ─────
# It opened its own PR, or it merged one. Either way this step has no business
# adding a draft on top of it.
newrepo d
git -C "$TMP/d" checkout -q -b steward/t-0050-done
echo x > "$TMP/d/f.txt"; git -C "$TMP/d" add -A; git -C "$TMP/d" commit -q -m work
git -C "$TMP/d" push -q -u origin steward/t-0050-done
: > "$TMP/calls.d"
STUB_FIND=""; out=$(runsalvage "$TMP/d" success)
if grep -q '^pr-create' "$TMP/calls.d"; then
  bad "salvage opened a draft PR over a successful run's own work"
else ok "a successful run with nothing unpushed is left entirely alone"; fi

# ── 5. A default branch is never pushed from, and never gets a PR ───────────
newrepo e
echo x > "$TMP/e/f.txt"; git -C "$TMP/e" add -A; git -C "$TMP/e" commit -q -m "on main"
STUB_FIND=""; out=$(runsalvage "$TMP/e" cancelled)
if grep -q '^pr-create' "$TMP/calls.e"; then
  bad "salvage opened a PR from a default branch"
else ok "a default branch is refused outright, as it always was"; fi

# ── 6. A REST refusal is a warning, never the run's status ──────────────────
newrepo f
cat > "$TMP/gh-rest.sh" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$STUB_CALLS"
case "${1:-}" in pr-find) exit 0 ;; *) echo "HTTP 403 Resource not accessible" >&2; exit 1 ;; esac
STUB
chmod +x "$TMP/gh-rest.sh"
git -C "$TMP/f" checkout -q -b steward/t-0060-refused
echo x > "$TMP/f/f.txt"; git -C "$TMP/f" add -A; git -C "$TMP/f" commit -q -m work
out=$(runsalvage "$TMP/f" cancelled); rc=$?
check "a PR that cannot be opened still exits 0" "$rc" "0"
check "…and says so as a warning" "$(grep -c 'could not open a draft PR' <<<"$out")" "1"
mkstub

# ── 7. Native exact resume must NEVER complete a push to a live PR branch ──
newrepo g
source_branch=steward/t-2420-live-owner
git -C "$TMP/g" checkout -q -b "$source_branch"
git -C "$TMP/g" push -q -u origin "$source_branch"
source_sha=$(git -C "$TMP/g.git" rev-parse "refs/heads/$source_branch")
echo private > "$TMP/g/f.txt"; git -C "$TMP/g" add -A; git -C "$TMP/g" commit -q -m private-one
echo two >> "$TMP/g/f.txt"; git -C "$TMP/g" commit -qam private-two
private_sha=$(git -C "$TMP/g" rev-parse HEAD)
expected_archive="steward/salvage/unqualified/12345/$private_sha"
out=$(runnative "$TMP/g" success)
check "native exact leaves the foreign-owned PR source unchanged" "$(git -C "$TMP/g.git" rev-parse "refs/heads/$source_branch")" "$source_sha"
check "native exact archives the actual private commit SHA" "$(git -C "$TMP/g.git" rev-parse "refs/heads/$expected_archive")" "$private_sha"
check "archive ref is unique to run and commit, without a ticket ID" "$(archives "$TMP/g.git")" "$expected_archive"
check "native exact does not open a draft over someone else's work" "$(cat "$TMP/calls.g")" ""
check "journal records the verified archive, not the application branch" "$(record_archives)" "$expected_archive"

# ── 8. Dirty WIP is durable, explicitly unqualified, and leaves source/index ──
newrepo h
git -C "$TMP/h" checkout -q -b "$source_branch"
echo old > "$TMP/h/deleted.txt"; git -C "$TMP/h" add -A; git -C "$TMP/h" commit -q -m existing
git -C "$TMP/h" push -q -u origin "$source_branch"
source_sha=$(git -C "$TMP/h" rev-parse HEAD)
rm "$TMP/h/deleted.txt"
echo staged > "$TMP/h/f.txt"; git -C "$TMP/h" add f.txt
echo final >> "$TMP/h/f.txt"
echo untracked > "$TMP/h/new.txt"
before_status=$(git -C "$TMP/h" status --porcelain)
before_index=$(git -C "$TMP/h" ls-files --stage)
out=$(runnative "$TMP/h" success)
archive=$(archives "$TMP/h.git")
archive_sha=$(git -C "$TMP/h.git" rev-parse "refs/heads/$archive")
check "dirty native success leaves the PR source unchanged" "$(git -C "$TMP/h.git" rev-parse "refs/heads/$source_branch")" "$source_sha"
check "dirty checkpoint retains original history" "$(git -C "$TMP/h.git" rev-parse "$archive_sha^")" "$source_sha"
check "dirty checkpoint contains final tracked content" "$(git -C "$TMP/h.git" show "$archive_sha:f.txt")" $'staged\nfinal'
check "dirty checkpoint includes untracked content" "$(git -C "$TMP/h.git" show "$archive_sha:new.txt")" "untracked"
check "dirty checkpoint preserves deletion" "$(git -C "$TMP/h.git" ls-tree --name-only "$archive_sha" deleted.txt)" ""
check "dirty checkpoint is explicitly UNQUALIFIED" "$(git -C "$TMP/h.git" log -1 --format=%s "$archive_sha")" "steward: UNQUALIFIED WIP archive from run 12345"
check "source branch remains checked out" "$(git -C "$TMP/h" branch --show-current)" "$source_branch"
check "agent's staged index remains unchanged" "$(git -C "$TMP/h" ls-files --stage)" "$before_index"
check "agent's dirty working tree remains unchanged" "$(git -C "$TMP/h" status --porcelain)" "$before_status"
check "dirty journal names the actual durable checkpoint" "$(record_archives)" "$archive"

# ── 9. Already-pushed work must not invent an archive or a salvage draft ────
newrepo i
git -C "$TMP/i" checkout -q -b "$source_branch"
git -C "$TMP/i" push -q -u origin "$source_branch"
out=$(runnative "$TMP/i" cancelled)
check "already-pushed native work creates no archive" "$(archives "$TMP/i.git")" ""
check "already-pushed native work creates no PR" "$(cat "$TMP/calls.i")" ""
check "already-pushed native journal claims no archive" "$(record_archives)" ""

# ── 10. A failed archive is warned about, never journalled as successful ────
newrepo j
git -C "$TMP/j" checkout -q -b "$source_branch"
git -C "$TMP/j" push -q -u origin "$source_branch"
source_sha=$(git -C "$TMP/j" rev-parse HEAD)
echo private > "$TMP/j/f.txt"; git -C "$TMP/j" add -A; git -C "$TMP/j" commit -q -m private
cat > "$TMP/j.git/hooks/pre-receive" <<'HOOK'
#!/usr/bin/env bash
echo 'fixture archive rejection' >&2
exit 1
HOOK
chmod +x "$TMP/j.git/hooks/pre-receive"
out=$(runnative "$TMP/j" cancelled); rc=$?
check "archive failure is best-effort exit 0" "$rc" "0"
check "archive failure leaves source unchanged" "$(git -C "$TMP/j.git" rev-parse "refs/heads/$source_branch")" "$source_sha"
check "rejected archive does not exist" "$(archives "$TMP/j.git")" ""
check "archive failure explicitly says recovery is unconfirmed" "$(grep -c 'recovery is not confirmed' <<<"$out")" "1"
check "archive failure does not claim nothing was unpushed" "$(grep -c 'salvage found nothing unpushed' <<<"$out")" "0"
check "journal never claims a rejected archive" "$(record_archives)" ""

# ── 11. Targeted first authoring is archive-only even without RESUME_PR ─────
newrepo k
git -C "$TMP/k" checkout -q -b "$source_branch"
echo private > "$TMP/k/f.txt"; git -C "$TMP/k" add -A; git -C "$TMP/k" commit -q -m private
private_sha=$(git -C "$TMP/k" rev-parse HEAD)
out=$(FOCUS_APP=chicago TARGET_TICKET=T-2420 RESUME_PR="" GITHUB_WORKSPACE="$TMP/k" GH_REST="$TMP/gh-rest.sh" bash "$SUT" 12345 cancelled 2>&1)
check "first authoring also archives the actual SHA" "$(git -C "$TMP/k.git" rev-parse "refs/heads/$(archives "$TMP/k.git")")" "$private_sha"
check "first authoring does not create an application source ref" "$(git -C "$TMP/k.git" for-each-ref --format='%(refname)' "refs/heads/$source_branch")" ""

# ── 12. Generic Chicago queue still fast-forwards its normal PR branch ─────
newrepo l
git -C "$TMP/l" checkout -q -b "$source_branch"
git -C "$TMP/l" push -q -u origin "$source_branch"
echo generic > "$TMP/l/f.txt"; git -C "$TMP/l" add -A; git -C "$TMP/l" commit -q -m generic
generic_sha=$(git -C "$TMP/l" rev-parse HEAD)
out=$(FOCUS_APP=chicago TARGET_TICKET="" RESUME_PR="" GITHUB_WORKSPACE="$TMP/l" GH_REST="$TMP/gh-rest.sh" bash "$SUT" 12345 cancelled 2>&1)
check "generic Chicago still fast-forwards the PR source" "$(git -C "$TMP/l.git" rev-parse "refs/heads/$source_branch")" "$generic_sha"
check "generic Chicago still opens its recovery draft" "$(grep -c '^pr-create .* draft$' "$TMP/calls.l")" "1"
check "generic Chicago creates no unqualified archive" "$(archives "$TMP/l.git")" ""

# ── 13. A successful push with unreadable remote verification is unconfirmed ──
newrepo m
git -C "$TMP/m" checkout -q -b "$source_branch"
git -C "$TMP/m" push -q -u origin "$source_branch"
source_sha=$(git -C "$TMP/m" rev-parse HEAD)
echo private > "$TMP/m/f.txt"; git -C "$TMP/m" add -A; git -C "$TMP/m" commit -q -m private
mkdir "$TMP/bin"
export REAL_GIT
REAL_GIT=$(command -v git)
cat > "$TMP/bin/git" <<'GIT'
#!/usr/bin/env bash
case "$*" in
  *'ls-remote --exit-code --heads origin refs/heads/steward/salvage/unqualified/'*) exit 1 ;;
esac
exec "$REAL_GIT" "$@"
GIT
chmod +x "$TMP/bin/git"
out=$(PATH="$TMP/bin:$PATH" runnative "$TMP/m" cancelled)
check "readback failure still leaves source unchanged" "$(git -C "$TMP/m.git" rev-parse "refs/heads/$source_branch")" "$source_sha"
check "readback failure fixture really pushed the checkpoint" "$(git -C "$TMP/m.git" rev-parse "refs/heads/$(archives "$TMP/m.git")")" "$(git -C "$TMP/m" rev-parse HEAD)"
check "readback failure warns recovery is unconfirmed" "$(grep -c 'recovery is not confirmed' <<<"$out")" "1"
check "unverified archive is not claimed in the journal" "$(record_archives)" ""

# ── 14. WIP before branch creation is recoverable, even in a partial context ──
newrepo n
source_sha=$(git -C "$TMP/n" rev-parse HEAD)
echo prebranch > "$TMP/n/wip.txt"
out=$(FOCUS_APP=chicago TARGET_TICKET="" RESUME_PR=1687 GITHUB_WORKSPACE="$TMP/n" GH_REST="$TMP/gh-rest.sh" bash "$SUT" 12345 cancelled 2>&1)
archive=$(archives "$TMP/n.git")
check "targeted default branch itself is never advanced" "$(git -C "$TMP/n.git" rev-parse refs/heads/main)" "$source_sha"
check "pre-branch dirty WIP survives on an unqualified archive" "$(git -C "$TMP/n.git" show "refs/heads/$archive:wip.txt")" "prebranch"
check "partial resume context fails closed to archive-only" "$(record_archives)" "$archive"

# ── 15. An unreadable commit count must not discard clean private HEAD ──────
newrepo o
git -C "$TMP/o" checkout -q -b "$source_branch"
git -C "$TMP/o" push -q -u origin "$source_branch"
source_sha=$(git -C "$TMP/o" rev-parse HEAD)
echo private > "$TMP/o/f.txt"; git -C "$TMP/o" add -A; git -C "$TMP/o" commit -q -m private
private_sha=$(git -C "$TMP/o" rev-parse HEAD)
cat > "$TMP/bin/git" <<'GIT'
#!/usr/bin/env bash
case "$*" in *'rev-list --count HEAD --not --remotes'*) exit 1 ;; esac
exec "$REAL_GIT" "$@"
GIT
out=$(PATH="$TMP/bin:$PATH" runnative "$TMP/o" cancelled)
expected_archive="steward/salvage/unqualified/12345/$private_sha"
check "unreadable commit count leaves the PR source unchanged" "$(git -C "$TMP/o.git" rev-parse "refs/heads/$source_branch")" "$source_sha"
check "unreadable commit count archives actual clean private HEAD" "$(git -C "$TMP/o.git" rev-parse "refs/heads/$expected_archive")" "$private_sha"
check "unreadable commit count journals the verified archive" "$(record_archives)" "$expected_archive"
check "unreadable commit count never claims no private work" "$(grep -c 'no unpushed commits\|salvage found nothing unpushed' <<<"$out")" "0"

echo
if [ "$fail" -eq 0 ]; then printf '\033[32mSALVAGE SELF-TEST PASS\033[0m — %d checks\n' "$pass"; exit 0
else printf '\033[31mSALVAGE SELF-TEST FAIL\033[0m — %d passed, %d failed\n' "$pass" "$fail"; exit 1; fi
