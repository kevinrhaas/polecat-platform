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
  GITHUB_WORKSPACE="$1" GH_REST="$TMP/gh-rest.sh" bash "$SUT" 12345 "$2" 2>&1
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

echo
if [ "$fail" -eq 0 ]; then printf '\033[32mSALVAGE SELF-TEST PASS\033[0m — %d checks\n' "$pass"; exit 0
else printf '\033[31mSALVAGE SELF-TEST FAIL\033[0m — %d passed, %d failed\n' "$pass" "$fail"; exit 1; fi
