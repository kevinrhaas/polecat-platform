#!/usr/bin/env bash
# test-journal.sh — drive journal.sh against a FAKE `gh`, through the ways the
# journal can fail. Same harness as test-gh-rest.sh: a script on PATH replays
# one scripted response per call from $FAKE_PLAN and logs every invocation.
#
# WHY (2026-09-27). The first journal issue, #56, reached GitHub's 2,500-comment
# limit and GitHub refused the next comment with a 403. Every janitor run went
# red on its journal step from then on, and every improve run — which marks the
# step continue-on-error — lost its entry without a word. The cases below are
# that refusal, the count that should have seen it coming, and the rule that a
# journal failure is never a run failure.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SUT="$HERE/journal.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
pass=0; fail=0
ok()   { printf '  \033[32mok\033[0m    %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; fail=$((fail+1)); }
has()  { if grep -qF -- "$2" "$3"; then ok "$1"; else bad "$1 — [$2] not in $(basename "$3")"; fi; }
hasnt(){ if grep -qF -- "$2" "$3"; then bad "$1 — [$2] found in $(basename "$3")"; else ok "$1"; fi; }

mkdir -p "$TMP/bin"
cat > "$TMP/bin/gh" <<'FAKE'
#!/usr/bin/env bash
n=$(cat "$FAKE_STATE" 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > "$FAKE_STATE"
printf '%s\n' "$*" >> "$FAKE_CALLS"
resp="${FAKE_PLAN}/${n}.txt"
[ -f "$resp" ] || resp="${FAKE_PLAN}/last.txt"
cat "$resp"
FAKE
chmod +x "$TMP/bin/gh"
export PATH="$TMP/bin:$PATH"
export GH_REST_CAP_SECONDS=1 GH_REST_ATTEMPTS=2

newplan(){ FAKE_PLAN="$TMP/plan.$1"; FAKE_STATE="$TMP/state.$1"; FAKE_CALLS="$TMP/calls.$1"
           export FAKE_PLAN FAKE_STATE FAKE_CALLS; rm -rf "$FAKE_PLAN"; mkdir -p "$FAKE_PLAN"
           : > "$FAKE_CALLS"; rm -f "$FAKE_STATE"; }
resp(){ printf 'HTTP/2.0 %s\n\n%s\n' "$2" "$3" > "$FAKE_PLAN/$1.txt"; }
CAP='{"message":"Commenting is disabled on issues with more than 2500 comments","status":"403"}'
echo "an entry" > "$TMP/summary.txt"
run(){ bash "$SUT" 9001 "Steward janitor" success "$TMP/summary.txt" >"$TMP/out.$1" 2>"$TMP/err.$1"; echo $? > "$TMP/rc.$1"; }

echo "journal.sh — the full journal and the failed post"

# ── 1. An ordinary entry: count under the line, posted to the open journal ────
newplan plain
resp 1 "422 Unprocessable Entity" '{"message":"already_exists"}'   # label-create
resp 2 "200 OK" '[{"number":56}]'                                  # issue-find
resp 3 "200 OK" '{"number":56,"comments":10}'                      # issue-comments
resp 4 "200 OK" '[]'                                         # comment-find: no claim notice
resp 5 "201 Created" '{"id":1}'                                    # issue-comment
run plain
has   "posts to the open journal" "→ issue #56" "$TMP/out.plain"
has   "exit 0" "0" "$TMP/rc.plain"
hasnt "does not open a new journal" "repos/kevinrhaas/polecat-platform/issues --input" "$FAKE_CALLS"

# ── 2. At the line: roll over BEFORE GitHub refuses ──────────────────────────
newplan roll
resp 1 "422 Unprocessable Entity" '{"message":"already_exists"}'
resp 2 "200 OK" '[{"number":56}]'
resp 3 "200 OK" '{"number":56,"comments":2450}'
resp 4 "201 Created" '{"number":200}'                              # issue-create
resp 5 "200 OK" '{"number":56,"state":"closed"}'                   # issue-close
resp 6 "200 OK" '[]'                                         # comment-find: no claim notice
resp 7 "201 Created" '{"id":2}'                                    # issue-comment
run roll
has "the successor is opened" "POST repos/kevinrhaas/polecat-platform/issues --input" "$FAKE_CALLS"
has "the full journal is closed" "PATCH repos/kevinrhaas/polecat-platform/issues/56" "$FAKE_CALLS"
has "the entry lands on the successor" "repos/kevinrhaas/polecat-platform/issues/200/comments" "$FAKE_CALLS"
has "and says it rolled" "rolled over to #200" "$TMP/err.roll"
has "exit 0" "0" "$TMP/rc.roll"
if grep -q "issue-create\|POST repos/kevinrhaas/polecat-platform/issues --input" "$FAKE_CALLS" \
   && [ "$(grep -n 'issues --input' "$FAKE_CALLS" | head -1 | cut -d: -f1)" -lt "$(grep -n 'issues/56 ' "$FAKE_CALLS" | grep PATCH | head -1 | cut -d: -f1)" ]; then
  ok "the successor opens before the old one closes (never zero open)"
else bad "the successor opens before the old one closes (never zero open)"; fi

# ── 3. The count could not be read, and GitHub refused for the cap ───────────
newplan refused
resp 1 "422 Unprocessable Entity" '{"message":"already_exists"}'
resp 2 "200 OK" '[{"number":56}]'
resp 3 "404 Not Found" '{"message":"Not Found"}'                  # count unreadable (not retried)
resp 4 "200 OK" '[]'                                         # comment-find: no claim notice
resp 5 "403 Forbidden" "$CAP"                                      # the real refusal
resp 6 "201 Created" '{"number":201}'
resp 7 "200 OK" '{"number":56,"state":"closed"}'
resp 8 "201 Created" '{"id":3}'
run refused
has "the refusal rolls the journal" "rolled over to #201" "$TMP/err.refused"
has "and the entry is retried on the successor" "→ issue #201" "$TMP/out.refused"
has "exit 0" "0" "$TMP/rc.refused"

# ── 4. Any other failure to post is a warning, never a red run ───────────────
newplan broken
resp 1 "422 Unprocessable Entity" '{"message":"already_exists"}'
resp 2 "200 OK" '[{"number":56}]'
resp 3 "200 OK" '{"number":56,"comments":10}'
resp 4 "200 OK" '[]'                                         # comment-find: no claim notice
resp 5 "404 Not Found" '{"message":"Not Found"}'
run broken
has "it says the entry was not posted" "was not posted" "$TMP/err.broken"
has "exit 0 — the journal is the write-up, not the verdict" "0" "$TMP/rc.broken"
hasnt "a non-cap failure does not roll" "PATCH" "$FAKE_CALLS"

# ── 5. A claim notice for this run is REPLACED, not answered with a second ────
newplan notice
resp 1 "422 Unprocessable Entity" '{"message":"already_exists"}'
resp 2 "200 OK" '[{"number":56}]'
resp 3 "200 OK" '{"number":56,"comments":10}'
resp 4 "200 OK" '[{"id":77,"body":"<!-- steward-run:9001 -->\nin progress"}]'
resp 5 "200 OK" '{"id":77}'                                        # comment-update
run notice
has   "the claim notice is replaced in place" "PATCH repos/kevinrhaas/polecat-platform/issues/comments/77" "$FAKE_CALLS"
hasnt "and no second comment is posted" "issues/56/comments --input" "$FAKE_CALLS"
has   "exit 0" "0" "$TMP/rc.notice"

echo
echo "journal.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
