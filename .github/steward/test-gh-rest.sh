#!/usr/bin/env bash
# test-gh-rest.sh — drive gh-rest.sh against a FAKE `gh`, so the retry path is
# exercised rather than assumed.
#
# The whole point of gh-rest.sh is what it does when GitHub says no. A test that
# only proves the happy path proves the part that was never broken: run 1140's
# PR was lost on a 403, and a green call tells you nothing about that. So every
# case here is a failure GitHub actually returned that day.
#
# The fake `gh` is a script on PATH that replays a scripted sequence of
# responses from $FAKE_PLAN, one per invocation, and records every call.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SUT="$HERE/gh-rest.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
pass=0; fail=0
ok()   { printf '  \033[32mok\033[0m    %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; fail=$((fail+1)); }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 — expected [$3], got [$2]"; fi; }

mkdir -p "$TMP/bin"
cat > "$TMP/bin/gh" <<'FAKE'
#!/usr/bin/env bash
# Replays $FAKE_PLAN (one response file per call) and logs each invocation.
n=$(cat "$FAKE_STATE" 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > "$FAKE_STATE"
printf '%s\n' "$*" >> "$FAKE_CALLS"
resp="${FAKE_PLAN}/${n}.txt"
[ -f "$resp" ] || resp="${FAKE_PLAN}/last.txt"
cat "$resp"
FAKE
chmod +x "$TMP/bin/gh"
export PATH="$TMP/bin:$PATH"
export GH_REST_CAP_SECONDS=1        # keep the suite fast; the arithmetic is still exercised
export GH_REST_ATTEMPTS=4

newplan(){ FAKE_PLAN="$TMP/plan.$1"; FAKE_STATE="$TMP/state.$1"; FAKE_CALLS="$TMP/calls.$1"
           export FAKE_PLAN FAKE_STATE FAKE_CALLS; rm -rf "$FAKE_PLAN"; mkdir -p "$FAKE_PLAN"
           : > "$FAKE_CALLS"; rm -f "$FAKE_STATE"; }
calls(){ wc -l < "$FAKE_CALLS" | tr -d ' '; }

echo "gh-rest.sh — the failure paths"

# ── 1. A secondary rate limit is retried, and the call then succeeds ─────────
# This is 16:05:30Z: core quota was fine, GitHub said no anyway.
newplan secondary
cat > "$FAKE_PLAN/1.txt" <<'EOF'
HTTP/2.0 403 Forbidden
retry-after: 1
x-ratelimit-remaining: 4900

{"message":"You have exceeded a secondary rate limit. Please wait a few minutes before you try again."}
EOF
cat > "$FAKE_PLAN/2.txt" <<'EOF'
HTTP/2.0 201 Created

{"number":402}
EOF
echo body > "$TMP/b.md"
got=$(bash "$SUT" pr-create o/r head base "t" "$TMP/b.md" 2>/dev/null)
check "a secondary rate limit is retried, not surfaced as a failure" "$got" "402"
check "…and it took exactly two calls to do it" "$(calls)" "2"

# ── 2. Primary exhaustion waits for the reset the header names ──────────────
newplan primary
cat > "$FAKE_PLAN/1.txt" <<EOF
HTTP/2.0 403 Forbidden
x-ratelimit-remaining: 0
x-ratelimit-reset: $(( $(date -u +%s) + 1 ))

{"message":"API rate limit exceeded for user ID 4193586."}
EOF
cat > "$FAKE_PLAN/2.txt" <<'EOF'
HTTP/2.0 200 OK

{"sha":"571491cc"}
EOF
got=$(bash "$SUT" pr-merge o/r 402 squash "title" 2>/dev/null)
check "primary exhaustion waits for x-ratelimit-reset and retries" "$got" "571491cc"

# ── 3. A 403 that is NOT a rate limit fails immediately ─────────────────────
# Retrying a permission error burns the budget this script exists to protect,
# and hides the real error behind five identical failures.
newplan perms
cat > "$FAKE_PLAN/last.txt" <<'EOF'
HTTP/2.0 403 Forbidden

{"message":"Resource not accessible by integration"}
EOF
bash "$SUT" pr-create o/r head base "t" "$TMP/b.md" >/dev/null 2>&1
check "a permission 403 is NOT retried" "$(calls)" "1"

# ── 4. A 422 fails immediately too (a PR that already exists) ───────────────
newplan unproc
cat > "$FAKE_PLAN/last.txt" <<'EOF'
HTTP/2.0 422 Unprocessable Entity

{"message":"A pull request already exists for o:head."}
EOF
bash "$SUT" pr-create o/r head base "t" "$TMP/b.md" >/dev/null 2>&1
check "a 422 is NOT retried" "$(calls)" "1"

# ── 5. Attempts are bounded — it gives up rather than sleeping forever ──────
newplan forever
cat > "$FAKE_PLAN/last.txt" <<'EOF'
HTTP/2.0 429 Too Many Requests
retry-after: 1

{"message":"You have exceeded a secondary rate limit."}
EOF
bash "$SUT" pr-create o/r head base "t" "$TMP/b.md" >/dev/null 2>&1
rc=$?
check "a permanent 429 gives up after GH_REST_ATTEMPTS" "$(calls)" "4"
check "…and reports failure rather than pretending to succeed" "$rc" "1"

# ── 6. Every request goes to a REST path — never `gh api graphql` ───────────
# This is the fault the script was built for: the endpoint, not the retry.
newplan rest
cat > "$FAKE_PLAN/last.txt" <<'EOF'
HTTP/2.0 200 OK

[]
EOF
bash "$SUT" pr-list o/r open 5 >/dev/null 2>&1
if grep -q 'graphql' "$FAKE_CALLS"; then bad "pr-list must not touch graphql"; else ok "pr-list goes to a REST path, not graphql"; fi
if grep -q 'repos/o/r/pulls' "$FAKE_CALLS"; then ok "…and it is the documented REST path"; else bad "pr-list did not call repos/o/r/pulls"; fi

# ── 7. pr-sweepable applies the janitor's three filters ────────────────────
# The janitor merges what this returns, so a wrong filter here merges a draft or
# something the owner parked with `hold`. Every exclusion is asserted.
newplan sweep
cat > "$FAKE_PLAN/last.txt" <<'EOF'
HTTP/2.0 200 OK

[{"number":1,"draft":false,"labels":[],"head":{"ref":"steward/good"}},
 {"number":2,"draft":true,"labels":[],"head":{"ref":"steward/draft"}},
 {"number":3,"draft":false,"labels":[{"name":"hold"}],"head":{"ref":"steward/parked"}},
 {"number":4,"draft":false,"labels":[],"head":{"ref":"feature/not-ours"}},
 {"number":5,"draft":false,"labels":[],"head":{"ref":"chore/polecat-shell-v1"}}]
EOF
got=$(bash "$SUT" pr-sweepable o/r '^(steward/|chore/polecat-shell)' 2>/dev/null | cut -f1 | tr '\n' ',')
check "pr-sweepable keeps only the sweepable PRs (drops draft, hold, foreign branch)" "$got" "1,5,"
check "…in a single request, so the per-PR view is retired" "$(calls)" "1"

# ── 8. comment-find returns the marked comment, and nothing when unmarked ──
# journal.sh decides between REPLACE and POST on this answer. Getting it wrong
# in the empty direction doubles the journal; in the other it overwrites someone
# else's comment.
newplan cfind
cat > "$FAKE_PLAN/last.txt" <<'EOF'
HTTP/2.0 200 OK

[{"id":11,"body":"unrelated chatter"},
 {"id":22,"body":"<!-- steward-run:999 -->\n### slice 3 of 8"},
 {"id":33,"body":"<!-- steward-run:1000 -->"}]
EOF
got=$(bash "$SUT" comment-find o/r 5 "steward-run:999" 2>/dev/null)
check "comment-find returns the id of the comment carrying the marker" "$got" "22"
got=$(bash "$SUT" comment-find o/r 5 "steward-run:absent" 2>/dev/null)
check "…and empty when no comment carries it (so journal.sh POSTs)" "$got" ""

# ── 9. claim-notice announces without the journal, and never fails the run ───
# It runs inside a live agent run; a failure here must cost an annotation, never
# the unit of work. Both no-journal and API-down are asserted to exit 0.
newplan claim
cat > "$FAKE_PLAN/last.txt" <<'EOF'
HTTP/2.0 403 Forbidden

{"message":"Resource not accessible by integration"}
EOF
export GITHUB_RUN_ID=999 GITHUB_STEP_SUMMARY="$TMP/summary.md" FOCUS_APP=custom
: > "$GITHUB_STEP_SUMMARY"
out=$(bash "$HERE/claim-notice.sh" 3 8 T-0191 "Randolph gets the street edge" 2>&1); rc=$?
check "claim-notice exits 0 even when every API call is refused" "$rc" "0"
if grep -q '::notice title=T-0191::' <<<"$out"; then ok "…and still emits the Actions annotation"; else bad "no ::notice:: annotation"; fi
if grep -q 'T-0191' "$GITHUB_STEP_SUMMARY"; then ok "…and still writes the step summary"; else bad "step summary not written"; fi
if grep -q 'slice 3/8 · custom · T-0191' "$GITHUB_STEP_SUMMARY"; then ok "…naming slice, app and ticket"; else bad "summary line malformed"; fi

out=$(bash "$HERE/claim-notice.sh" 3 8 "" "no ticket" 2>&1); rc=$?
check "claim-notice with no ticket is a no-op, not a failure" "$rc" "0"
unset GITHUB_RUN_ID GITHUB_STEP_SUMMARY FOCUS_APP

# ── 10. No steward subcommand shells out to a GraphQL-backed `gh pr|issue` ──
if grep -nE '^[^#]*gh (pr|issue|search) ' "$SUT" >/dev/null; then
  bad "gh-rest.sh itself still calls a GraphQL-backed gh subcommand"
else
  ok "gh-rest.sh calls no GraphQL-backed gh subcommand of its own"
fi

echo
if [ "$fail" -eq 0 ]; then printf '\033[32mGH-REST SELF-TEST PASS\033[0m — %d checks\n' "$pass"; exit 0
else printf '\033[31mGH-REST SELF-TEST FAIL\033[0m — %d passed, %d failed\n' "$pass" "$fail"; exit 1; fi
