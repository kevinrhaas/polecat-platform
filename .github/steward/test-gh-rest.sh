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

[{"number":1,"draft":false,"labels":[],"head":{"ref":"steward/good"},"base":{"ref":"dev"}},
 {"number":2,"draft":true,"labels":[],"head":{"ref":"steward/draft"},"base":{"ref":"dev"}},
 {"number":3,"draft":false,"labels":[{"name":"hold"}],"head":{"ref":"steward/parked"},"base":{"ref":"main"}},
 {"number":4,"draft":false,"labels":[],"head":{"ref":"feature/not-ours"},"base":{"ref":"main"}},
 {"number":5,"draft":false,"labels":[],"head":{"ref":"chore/polecat-shell-v1"},"base":{"ref":"main"}}]
EOF
got=$(bash "$SUT" pr-sweepable o/r '^(steward/|chore/polecat-shell)' 2>/dev/null | cut -f1 | tr '\n' ',')
check "pr-sweepable keeps only the sweepable PRs (drops draft, hold, foreign branch)" "$got" "1,5,"
check "…in a single request, so the per-PR view is retired" "$(calls)" "1"

# T-0809: the base comes back too, because the janitor now merges the base into
# the branch and gates the MERGE. Assuming `main` would gate the wrong tree on
# every dev-first repo — jobtracker, analytics and chicago/4d are all dev-first.
newplan sweep_base
cp "$TMP/plan.sweep/last.txt" "$FAKE_PLAN/last.txt"
got=$(bash "$SUT" pr-sweepable o/r '^(steward/|chore/polecat-shell)' 2>/dev/null | tr '\t' ':' | tr '\n' ',')
check "pr-sweepable returns number, head AND base" "$got" "1:steward/good:dev,5:chore/polecat-shell-v1:main,"

# ── 7b. pr-automerge arms, and falls back to a plain merge when it cannot ──
# Auto-merge is the only thing here with no REST endpoint, so it is the only
# GraphQL call in the file. What matters is that it is never WORSE than
# pr-merge: if GitHub will not queue the PR, the merge still has to happen.
newplan automerge_ok
cat > "$FAKE_PLAN/1.txt" <<'EOF'
HTTP/2.0 200 OK

{"number":7,"node_id":"PR_kwDO"}
EOF
cat > "$FAKE_PLAN/2.txt" <<'EOF'
{"data":{"enablePullRequestAutoMerge":{"pullRequest":{"number":7,"autoMergeRequest":{"enabledAt":"2026-09-05T18:00:00Z"}}}}}
EOF
got=$(bash "$SUT" pr-automerge o/r 7 squash 2>/dev/null)
check "pr-automerge arms auto-merge and says so" "$got" "armed"
check "…in exactly two calls: one REST for the node id, one mutation" "$(calls)" "2"

newplan automerge_clean
cat > "$FAKE_PLAN/1.txt" <<'EOF'
HTTP/2.0 200 OK

{"number":8,"node_id":"PR_kwDO"}
EOF
# What GitHub says when there is nothing left to wait for, or when the repo has
# no required check on the base branch — both mean "merge it now".
cat > "$FAKE_PLAN/2.txt" <<'EOF'
GraphQL: Pull request is in clean status (enablePullRequestAutoMerge)
EOF
cat > "$FAKE_PLAN/3.txt" <<'EOF'
HTTP/2.0 200 OK

{"sha":"deadbee"}
EOF
got=$(bash "$SUT" pr-automerge o/r 8 squash "title" 2>/dev/null)
check "pr-automerge that cannot arm falls back to merging, and still merges" "$got" "deadbee"

# ── 7c. pr-state answers, and answers EMPTY rather than failing ────────────
# The janitor merges on an empty answer, so the failure path is the one that
# matters: if a 500 came back as a non-zero exit, a transient GitHub blip would
# stop every merge in the fleet instead of the one closed PR this guards against.
newplan state_closed
cat > "$FAKE_PLAN/1.txt" <<'EOF'
HTTP/2.0 200 OK

{"number":1303,"state":"closed"}
EOF
got=$(bash "$SUT" pr-state o/r 1303 2>/dev/null)
check "pr-state reports a closed PR as closed" "$got" "closed"
check "…in one request" "$(calls)" "1"

newplan state_unreadable
cat > "$FAKE_PLAN/last.txt" <<'EOF'
HTTP/2.0 500 Internal Server Error

{"message":"Server Error"}
EOF
got=$(bash "$SUT" pr-state o/r 1303 2>/dev/null); rc=$?
check "pr-state that cannot read the PR prints nothing" "$got" ""
check "…and still exits 0, so the caller falls through to merging" "$rc" "0"

# ── 9. `draft` is sent only when asked for (salvage.sh's PR) ────────────────
# A draft says "not reviewed, not gated" in the one place a reviewer looks, and
# salvage opens every one of its pull requests that way. The flag is positional
# and easy to send by accident, so both directions are asserted.
newplan draft
cat > "$FAKE_PLAN/last.txt" <<'EOF'
HTTP/2.0 201 Created

{"number":77}
EOF
bash "$SUT" pr-create o/r head base "t" "$TMP/b.md" draft >/dev/null 2>&1
if python3 -c 'import json,sys;sys.exit(0 if json.load(open("/tmp/gh-rest-pr.json")).get("draft") is True else 1)'; then
  ok "pr-create sends draft:true when the sixth argument says draft"
else bad "pr-create did not send draft:true"; fi

newplan nodraft
cat > "$FAKE_PLAN/last.txt" <<'EOF'
HTTP/2.0 201 Created

{"number":78}
EOF
bash "$SUT" pr-create o/r head base "t" "$TMP/b.md" >/dev/null 2>&1
if python3 -c 'import json,sys;sys.exit(0 if "draft" not in json.load(open("/tmp/gh-rest-pr.json")) else 1)'; then
  ok "…and omits the key entirely when it is not asked for"
else bad "pr-create sent a draft key when none was asked for"; fi

# ── 10. `pr-find` can ask about EVERY state, which is salvage's question ─────
# "Is there an open PR I can merge?" and "did this branch ever have one?" are
# different questions, and salvage asks the second: a closed or merged PR means
# the branch was never invisible, which is the only fault it is guarding.
newplan findall
cat > "$FAKE_PLAN/last.txt" <<'EOF'
HTTP/2.0 200 OK

[]
EOF
bash "$SUT" pr-find o/r some-branch all >/dev/null 2>&1
if grep -q 'state=all&head=o:some-branch' "$FAKE_CALLS"; then
  ok "pr-find passes the state through, and still qualifies head with the owner"
else bad "pr-find did not ask for state=all — $(cat "$FAKE_CALLS")"; fi

bash "$SUT" pr-find o/r some-branch >/dev/null 2>&1
if grep -q 'state=open&head=o:some-branch' "$FAKE_CALLS"; then
  ok "…and still defaults to open for every caller that came before it"
else bad "pr-find's default state is no longer open"; fi

# ── 8. No steward subcommand shells out to a GraphQL-backed `gh pr|issue` ───
if grep -nE '^[^#]*gh (pr|issue|search) ' "$SUT" >/dev/null; then
  bad "gh-rest.sh itself still calls a GraphQL-backed gh subcommand"
else
  ok "gh-rest.sh calls no GraphQL-backed gh subcommand of its own"
fi

echo
if [ "$fail" -eq 0 ]; then printf '\033[32mGH-REST SELF-TEST PASS\033[0m — %d checks\n' "$pass"; exit 0
else printf '\033[31mGH-REST SELF-TEST FAIL\033[0m — %d passed, %d failed\n' "$pass" "$fail"; exit 1; fi
