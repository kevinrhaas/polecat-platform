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
 {"number":5,"draft":false,"labels":[],"head":{"ref":"chore/polecat-shell-v1"},"base":{"ref":"main"}},
 {"number":6,"draft":false,"labels":[{"name":"resume"}],"head":{"ref":"steward/handed-on"},"base":{"ref":"dev"}}]
EOF
got=$(bash "$SUT" pr-sweepable o/r '^(steward/|chore/polecat-shell)' 2>/dev/null | cut -f1 | tr '\n' ',')
check "pr-sweepable keeps only the sweepable PRs (drops draft, hold, foreign branch)" "$got" "1,5,6,"
check "…in a single request, so the per-PR view is retired" "$(calls)" "1"

# T-1577 — THE TWO LABELS, AND THE JANITOR READS THEM DIFFERENTLY. This is the
# fixture the acceptance asks for: a `resume` PR is picked up and a `hold` PR is
# not. Both halves are asserted from the same list, because the fault being
# fixed was one label doing both jobs — #6 above is the run's own unfinished
# work, which is exactly what the sweep is for, and #3 is the owner deciding.
newplan sweep_labels
cp "$TMP/plan.sweep/last.txt" "$FAKE_PLAN/last.txt"
got=$(bash "$SUT" pr-sweepable o/r '^(steward/|chore/polecat-shell)' 2>/dev/null | cut -f1 | tr '\n' ',')
case ",$got" in *,6,*) ok "a \`resume\` PR is swept — it is work the loop still owes" ;;
                    *) bad "a \`resume\` PR must be swept, got [$got]" ;; esac
case ",$got" in *,3,*) bad "a \`hold\` PR must NOT be swept, got [$got]" ;;
                    *) ok "…and a \`hold\` PR is not — that one is the owner's" ;; esac

# T-0809: the base comes back too, because the janitor now merges the base into
# the branch and gates the MERGE. Assuming `main` would gate the wrong tree on
# every dev-first repo — jobtracker, analytics and chicago/4d are all dev-first.
newplan sweep_base
cp "$TMP/plan.sweep/last.txt" "$FAKE_PLAN/last.txt"
got=$(bash "$SUT" pr-sweepable o/r '^(steward/|chore/polecat-shell)' 2>/dev/null | tr '\t' ':' | tr '\n' ',')
check "pr-sweepable returns number, head AND base" "$got" "1:steward/good:dev,5:chore/polecat-shell-v1:main,6:steward/handed-on:dev,"

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

{"number":8,"node_id":"PR_kwDO","head":{"sha":"c0ffee1234567"}}
EOF
# What GitHub says when there is nothing left to wait for, or when the repo has
# no required check on the base branch — both mean "merge it now".
cat > "$FAKE_PLAN/2.txt" <<'EOF'
GraphQL: Pull request is in clean status (enablePullRequestAutoMerge)
EOF
# T-1572: the fallback no longer merges blind — it reads the head commit's own
# check runs first. Green, so the merge still happens.
cat > "$FAKE_PLAN/3.txt" <<'EOF'
HTTP/2.0 200 OK

{"total_count":1,"check_runs":[{"name":"chicago-4d-check","status":"completed","conclusion":"success"}]}
EOF
cat > "$FAKE_PLAN/4.txt" <<'EOF'
HTTP/2.0 200 OK

{"sha":"deadbee"}
EOF
got=$(bash "$SUT" pr-automerge o/r 8 squash "title" 2>/dev/null)
check "pr-automerge that cannot arm reads the gate, and merges it when green" "$got" "deadbee"

# ── 7b-i. T-1572: a RED gate is refused, not merged ────────────────────────
# The fault this is for: kevinrhaas/chicago has auto-merge switched OFF, so the
# "could not arm" branch is the ONLY branch ever taken there, and it used to
# merge on the spot. PR #43 landed on a `dev` whose check was already red,
# about one second after it was opened.
newplan automerge_red
cat > "$FAKE_PLAN/1.txt" <<'EOF'
HTTP/2.0 200 OK

{"number":43,"node_id":"PR_kwDO","head":{"sha":"c0ffee1234567"}}
EOF
cat > "$FAKE_PLAN/2.txt" <<'EOF'
GraphQL: Auto merge is not allowed for this repository (enablePullRequestAutoMerge)
EOF
cat > "$FAKE_PLAN/3.txt" <<'EOF'
HTTP/2.0 200 OK

{"total_count":2,"check_runs":[{"name":"chicago-4d-check","status":"completed","conclusion":"failure"},
                               {"name":"smoke","status":"completed","conclusion":"success"}]}
EOF
cat > "$FAKE_PLAN/last.txt" <<'EOF'
HTTP/2.0 200 OK

{}
EOF
got=$(bash "$SUT" pr-automerge o/r 43 squash "title" 2>/dev/null); rc=$?
check "a red check is REFUSED, not merged"                     "$got" "refused"
check "…and it exits 3, so the caller can tell refusal from a REST failure" "$rc" "3"
if grep -q 'repos/o/r/pulls/43/merge' "$FAKE_CALLS"; then bad "a refused PR must not be merged"
else ok "…and no merge request was made at all"; fi
# T-1577: `resume`, never `hold` — a refused PR needs no ruling from anybody, it
# needs a machine to lap it and merge it when the check goes green, and `hold`
# would take it out of the janitor's sweep for ever.
if grep -q 'repos/o/r/issues/43/comments' "$FAKE_CALLS"; then ok "…and told why, on the PR itself"
else bad "a refused PR must be told why"; fi
if grep -q 'repos/o/r/issues/43/labels' "$FAKE_CALLS"; then ok "…and labelled, so the next pass knows what it is"
else bad "a refused PR must be labelled"; fi
if grep -q 'DELETE repos/o/r/issues/43/labels/hold' "$FAKE_CALLS"; then ok '…with resume, and hold taken off — a run never parks the owner'"'"'s switch'
else bad "a refused PR must go to resume, not hold (T-1577)"; fi
if grep -qE '\-f name=hold|"labels":\["hold"\]' "$FAKE_CALLS"; then bad "a refused PR must never be labelled hold (T-1577)"
else ok "…and hold is never applied by the refusal itself"; fi

# ── 7b-ii. A PENDING gate comes back as `pending`, for the caller to lap ─────
# Arming would have waited for the checks; without it the wait is ours to make,
# and it is BOUNDED — a slice cannot be held open indefinitely, and one Bash tool
# call cannot run past 600 s at all. So the bound is per CALL and expiring it is
# not a verdict: `pending`, exit 4, PR untouched, caller decides (T-1609).
newplan automerge_pending
cat > "$FAKE_PLAN/1.txt" <<'EOF'
HTTP/2.0 200 OK

{"number":9,"node_id":"PR_kwDO","head":{"sha":"c0ffee1234567"}}
EOF
cat > "$FAKE_PLAN/2.txt" <<'EOF'
GraphQL: Auto merge is not allowed for this repository (enablePullRequestAutoMerge)
EOF
cat > "$FAKE_PLAN/3.txt" <<'EOF'
HTTP/2.0 200 OK

{"total_count":1,"check_runs":[{"name":"chicago-4d-check","status":"in_progress","conclusion":null}]}
EOF
cat > "$FAKE_PLAN/last.txt" <<'EOF'
HTTP/2.0 200 OK

{}
EOF
got=$(GH_REST_GATE_WAIT_SECONDS=0 bash "$SUT" pr-automerge o/r 9 squash "title" 2>/dev/null); rc=$?
check "a still-pending gate is handed back as pending, not merged past" "$got" "pending"
check "…and exits 4, which is NOT the red-check exit 3 (T-1609)" "$rc" "4"
if grep -q 'repos/o/r/pulls/9/merge' "$FAKE_CALLS"; then bad "a pending PR must not be merged"
else ok "…and again, no merge request was made"; fi

# T-1609: a PENDING gate is not a verdict, so it must not be dressed as one. No
# label, no reason comment — the caller has not finished deciding, and a reason
# written here would be stale the moment the gate goes green (the drift T-1577
# measured). The run that gives up waiting calls `pr-resume` itself.
if grep -qE '/labels|-f name=' "$FAKE_CALLS"; then bad "a pending PR must not be labelled (T-1609)"
else ok "…and it is left UNLABELLED — pending is not a handoff"; fi
if grep -q 'repos/o/r/issues/9/comments' "$FAKE_CALLS"; then bad "a pending PR must not be given a reason it may not need"
else ok "…and no reason is written onto work that is still being gated"; fi

# ── 7b-ii-b. T-1609: the gate is read AT the deadline, not a poll short of it ──
# The old arithmetic was `now + GATE_POLL > deadline`, so the effective wait was
# GATE_WAIT - GATE_POLL and the gate was never read at the instant the budget
# expired. Here the budget is 1 s and the poll interval is 20 s: the old code
# refused after a SINGLE read, having waited none of its budget. PR #63's real
# gate went green 6 s past the mark, so this interval is a merged unit's worth.
newplan automerge_deadline_read
cat > "$FAKE_PLAN/1.txt" <<'EOF'
HTTP/2.0 200 OK

{"number":44,"node_id":"PR_kwDO","head":{"sha":"1a5tp011"}}
EOF
cat > "$FAKE_PLAN/2.txt" <<'EOF'
GraphQL: Auto merge is not allowed for this repository (enablePullRequestAutoMerge)
EOF
cat > "$FAKE_PLAN/3.txt" <<'EOF'
HTTP/2.0 200 OK

{"total_count":1,"check_runs":[{"name":"chicago-4d-check","status":"in_progress","conclusion":null}]}
EOF
cat > "$FAKE_PLAN/4.txt" <<'EOF'
HTTP/2.0 200 OK

{"total_count":1,"check_runs":[{"name":"chicago-4d-check","status":"completed","conclusion":"success"}]}
EOF
cat > "$FAKE_PLAN/5.txt" <<'EOF'
HTTP/2.0 200 OK

{"sha":"1a5tp01"}
EOF
got=$(GH_REST_GATE_WAIT_SECONDS=1 GH_REST_GATE_POLL_SECONDS=20 \
        bash "$SUT" pr-automerge o/r 44 squash "title" 2>/dev/null)
check "a gate that goes green on the last poll is MERGED, not deferred" "$got" "1a5tp01"
check "…having read the gate twice: the budget is waited out, not rounded down" "$(calls)" "5"

# ── 7b-iii. No checks at all still merges — most steward PRs have none ─────
# A bot-opened PR triggers no workflow on several fleet repos, so "no check
# runs" is the normal state of a perfectly good PR. Refusing it would stop
# every merge in the fleet, which is a far larger fault than the one fixed.
newplan automerge_nochecks
cat > "$FAKE_PLAN/1.txt" <<'EOF'
HTTP/2.0 200 OK

{"number":10,"node_id":"PR_kwDO","head":{"sha":"c0ffee1234567"}}
EOF
cat > "$FAKE_PLAN/2.txt" <<'EOF'
GraphQL: Auto merge is not allowed for this repository (enablePullRequestAutoMerge)
EOF
cat > "$FAKE_PLAN/3.txt" <<'EOF'
HTTP/2.0 200 OK

{"total_count":0,"check_runs":[]}
EOF
cat > "$FAKE_PLAN/4.txt" <<'EOF'
HTTP/2.0 200 OK

{"sha":"beefbee"}
EOF
got=$(GH_REST_GATE_WAIT_SECONDS=0 bash "$SUT" pr-automerge o/r 10 squash "title" 2>/dev/null)
check "a PR with no checks at all is still merged" "$got" "beefbee"

# ── 7b-iv. An unreadable gate merges, like pr-state's empty answer ─────────
# Same contract as pr-state: a transient GitHub blip must not stop every merge
# in the fleet. This guards one bad merge; it is not a safety interlock worth
# putting a 500 in the path of every one.
newplan automerge_unreadable
cat > "$FAKE_PLAN/1.txt" <<'EOF'
HTTP/2.0 200 OK

{"number":11,"node_id":"PR_kwDO","head":{"sha":"c0ffee1234567"}}
EOF
cat > "$FAKE_PLAN/2.txt" <<'EOF'
GraphQL: Auto merge is not allowed for this repository (enablePullRequestAutoMerge)
EOF
cat > "$FAKE_PLAN/3.txt" <<'EOF'
HTTP/2.0 200 OK

not json at all
EOF
cat > "$FAKE_PLAN/4.txt" <<'EOF'
HTTP/2.0 200 OK

{"sha":"facade0"}
EOF
got=$(GH_REST_GATE_WAIT_SECONDS=0 bash "$SUT" pr-automerge o/r 11 squash "title" 2>/dev/null)
check "an unreadable gate merges rather than stalling the fleet" "$got" "facade0"

# ── 7b-v. The escape hatch still merges blind, for when that is wanted ─────
newplan automerge_blind
cat > "$FAKE_PLAN/1.txt" <<'EOF'
HTTP/2.0 200 OK

{"number":12,"node_id":"PR_kwDO","head":{"sha":"c0ffee1234567"}}
EOF
cat > "$FAKE_PLAN/2.txt" <<'EOF'
GraphQL: Auto merge is not allowed for this repository (enablePullRequestAutoMerge)
EOF
cat > "$FAKE_PLAN/3.txt" <<'EOF'
HTTP/2.0 200 OK

{"sha":"0ldway5"}
EOF
got=$(GH_REST_MERGE_BLIND=1 bash "$SUT" pr-automerge o/r 12 squash "title" 2>/dev/null)
check "GH_REST_MERGE_BLIND=1 restores the unconditional merge" "$got" "0ldway5"
check "…and reads no gate to do it" "$(calls)" "3"

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

# ── 7d. pr-resume writes the reason BEFORE the label, and never both ───────
# T-1577. The fault this verb closes is a PR parked with its reason in the body,
# where nobody read it; the ordering is therefore the contract, not a detail —
# a labelled PR must never exist without its reason beside it.
newplan resume_ok
cat > "$FAKE_PLAN/last.txt" <<'EOF'
HTTP/2.0 200 OK

{}
EOF
got=$(bash "$SUT" pr-resume o/r 41 --why "dev's gate is red on T-1567" --waits-on T-1567 2>/dev/null | tail -1)
check "pr-resume says what it handed off and what it waits on" "$got" "resume: #41 handed off · waits on: T-1567"
order=$(grep -nE 'issues/41/(comments|labels)' "$FAKE_CALLS" | head -2 | sed -E 's#.*issues/41/([a-z]+).*#\1#' | tr '\n' ',')
check "…the comment goes on BEFORE the label" "$order" "comments,labels,"
if grep -q "labels/hold" "$FAKE_CALLS"; then ok "…and it takes \`hold\` off, since the work is unfinished and not parked"
else bad "pr-resume must remove \`hold\` — leaving both on leaves every pass skipping it"; fi
if grep -q 'repos/o/r/labels' "$FAKE_CALLS"; then ok "…after minting \`resume\` idempotently, so the first handoff is not label-less"
else bad "pr-resume did not create the \`resume\` label"; fi

# The machine-readable first line, which is what the lap, the board and the next
# run all read. A newline in the reason would push it off line one.
body=$(python3 -c 'import json,sys;print(json.load(open("/tmp/gh-rest-comment.json"))["body"])')
check "the first line is the structured one" "$(printf '%s' "$body" | head -1)" \
  "resume: dev's gate is red on T-1567 · waits on: T-1567"
newplan resume_multiline
cat > "$FAKE_PLAN/last.txt" <<'EOF'
HTTP/2.0 200 OK

{}
EOF
bash "$SUT" pr-resume o/r 42 --why "$(printf 'clock ran out\nmid-gate')" >/dev/null 2>&1
body=$(python3 -c 'import json,sys;print(json.load(open("/tmp/gh-rest-comment.json"))["body"])')
check "a multi-line reason is flattened onto line one" "$(printf '%s' "$body" | head -1)" \
  "resume: clock ran out mid-gate · waits on: nothing"

# A handoff with no reason is the fault this verb exists to end, so it is a
# usage error — and nothing is sent, so no PR is left labelled and mute.
newplan resume_noreason
bash "$SUT" pr-resume o/r 43 >/dev/null 2>&1; rc=$?
check "pr-resume without --why is a usage error" "$rc" "2"
check "…and it made no request at all" "$(calls)" "0"

newplan resume_badwaits
bash "$SUT" pr-resume o/r 43 --why x --waits-on "soon" >/dev/null 2>&1; rc=$?
check "pr-resume rejects a --waits-on that is not a ticket id" "$rc" "2"
check "…and made no request for it either" "$(calls)" "0"

# ── 8. No steward subcommand shells out to a GraphQL-backed `gh pr|issue` ───
if grep -nE '^[^#]*gh (pr|issue|search) ' "$SUT" >/dev/null; then
  bad "gh-rest.sh itself still calls a GraphQL-backed gh subcommand"
else
  ok "gh-rest.sh calls no GraphQL-backed gh subcommand of its own"
fi

echo
if [ "$fail" -eq 0 ]; then printf '\033[32mGH-REST SELF-TEST PASS\033[0m — %d checks\n' "$pass"; exit 0
else printf '\033[31mGH-REST SELF-TEST FAIL\033[0m — %d passed, %d failed\n' "$pass" "$fail"; exit 1; fi
