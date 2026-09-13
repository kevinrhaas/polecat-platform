#!/usr/bin/env bash
# test-janitor-sweep.sh — run the janitor's REAL sweep body against fakes.
#
# The body is not copied here: it is EXTRACTED from
# .github/workflows/steward-janitor.yml, so this tests the shipped code and a
# change to the workflow that breaks the contract fails here rather than on the
# fleet two hours later.
#
# What it is guarding (T-0809): the janitor gated the branch UN-MERGED and, when
# the merge then failed on conflict, printed one line and said nothing to anyone.
# Measured 2026-09-13 on kevinrhaas/custom: all FIVE open steward PRs conflicted
# with `dev` — on `changelog.js`, `QUEUE.md` and `dev-smoke-state.json`, which
# that repo deliberately does NOT union-merge — and every sweep had skipped all
# five in silence while their tickets read `open` at the top of the queue.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WF="$HERE/../workflows/steward-janitor.yml"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
pass=0; fail=0
ok()   { printf '  \033[32mok\033[0m    %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; fail=$((fail+1)); }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 — expected [$3], got [$2]"; fi; }

# ── extract the step, verbatim ───────────────────────────────────────────────
python3 - "$WF" "$TMP/sweep.sh" <<'PY'
import sys, yaml
wf, out = sys.argv[1], sys.argv[2]
steps = yaml.safe_load(open(wf))['jobs']['sweep']['steps']
body = [s for s in steps if s.get('name','').startswith('Sweep and merge')]
assert len(body) == 1, f'expected one sweep step, found {len(body)}'
open(out,'w').write("#!/usr/bin/env bash\nset -uo pipefail\n" + body[0]['run'])
PY
[ -s "$TMP/sweep.sh" ] || { echo "could not extract the sweep step"; exit 1; }
bash -n "$TMP/sweep.sh" || { echo "the extracted sweep body does not parse"; exit 1; }

# ── the fakes ────────────────────────────────────────────────────────────────
# GITHUB_WORKSPACE is where the body looks for its two helpers, so a fake
# workspace is all it takes to intercept both.
WS="$TMP/ws"; mkdir -p "$WS/.github/steward"
export GITHUB_WORKSPACE="$WS"
export HOME="$TMP/home"; mkdir -p "$HOME"   # keep `git config --global` off the runner
export FLEET=testrepo
export GH_TOKEN=fake
export FAKE_CALLS="$TMP/calls"; : > "$FAKE_CALLS"
export FAKE_COMMENTS="$TMP/comments"; : > "$FAKE_COMMENTS"

cat > "$WS/.github/steward/gh-rest.sh" <<'FAKE'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FAKE_CALLS"
case "$1" in
  pr-sweepable) printf '%s\n' "$FAKE_PRS" ;;
  comments-list) cat "$FAKE_COMMENTS" ;;
  pr-comment)    cat "$4" >> "$FAKE_COMMENTS" ;;
  pr-merge)      [ "${FAKE_MERGE_FAILS:-}" = "$3" ] && exit 1; echo deadbeef ;;
  branch-delete) : ;;
esac
FAKE

# Behaviour keyed off the branch name, so one fake covers every outcome.
cat > "$WS/.github/steward/janitor-mergeability.sh" <<'FAKE'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FAKE_CALLS"
dir="$3"; base="$4"; head="$5"
case "$head" in
  *conflict*) echo CONFLICT; printf 'js/changelog.js\ntickets/QUEUE.md\n'; exit 1 ;;
  *unknown*)  echo "UNKNOWN fetch of $base/$head failed"; exit 2 ;;
esac
mkdir -p "$dir/.github"
if [ "${head#*red}" != "$head" ]; then echo 'process.exit(1)' > "$dir/.github/smoke-test.mjs"
else echo 'process.exit(0)' > "$dir/.github/smoke-test.mjs"; fi
echo "MERGED cafe1234"
FAKE
chmod +x "$WS/.github/steward/"*.sh

run_sweep() { ( cd "$TMP" && bash "$TMP/sweep.sh" ) > "$TMP/log" 2>&1; }
called() { grep -c "^$1" "$FAKE_CALLS"; }

echo "steward-janitor.yml — a PR that cannot merge is never silent"

# ── 1. a conflict is named, out loud, exactly once ───────────────────────────
export FAKE_PRS=$'11\tsteward/conflict-one\tdev'
run_sweep
check "a conflicting PR is not merged"                      "$(called pr-merge)" "0"
check "…it is commented on"                                 "$(called pr-comment)" "1"
check "…the comment carries the guard marker"               "$(grep -c 'Steward janitor: cannot merge' "$FAKE_COMMENTS")" "1"
check "…and names the conflicting paths"                    "$(grep -c 'tickets/QUEUE.md' "$FAKE_COMMENTS")" "1"
check "…and says which base it cannot merge into"           "$(grep -c '`dev`' "$FAKE_COMMENTS")" "1"
if grep -q 'CONFLICTING kevinrhaas/testrepo#11' /tmp/steward-out.txt; then
  ok "…and the journal records it as conflicting, not as nothing"
else bad "…the journal line is missing: $(cat /tmp/steward-out.txt)"; fi

# ── 2. the second sweep does not say it again ────────────────────────────────
: > "$FAKE_CALLS"
run_sweep
check "the next sweep repeats no comment (the guard holds)"  "$(called pr-comment)" "0"
check "…and still refuses to merge it"                       "$(called pr-merge)" "0"

# ── 3. the merge result is what gets gated, and green still ships ───────────
: > "$FAKE_CALLS"; : > "$FAKE_COMMENTS"
export FAKE_PRS=$'12\tsteward/clean-green\tmain'
run_sweep
check "a clean, green PR is merged"                          "$(called pr-merge)" "1"
check "…and its branch deleted"                              "$(called branch-delete)" "1"
if grep -q 'prepare .* main steward/clean-green' "$FAKE_CALLS"; then
  ok "…and the gate ran on the MERGE of the PR's own base, not on an assumed main"
else bad "…prepare was not asked for base/head: $(cat "$FAKE_CALLS")"; fi
check "…and a mergeable PR is never commented on"            "$(called pr-comment)" "0"

# ── 4. a red gate is still a red gate, and still not a conflict ─────────────
: > "$FAKE_CALLS"; : > "$FAKE_COMMENTS"
export FAKE_PRS=$'13\tsteward/clean-red-gate\tdev'
run_sweep
check "a red gate is not merged"                             "$(called pr-merge)" "0"
check "…and gets the smoke-failure comment, not the conflict one" \
      "$(grep -c 'smoke gate FAILED' "$FAKE_COMMENTS")" "1"
check "…and is not mislabelled as a conflict"                "$(grep -c 'cannot merge' "$FAKE_COMMENTS")" "0"

# ── 5. undetermined mergeability waits for the next sweep, and says so ──────
: > "$FAKE_CALLS"; : > "$FAKE_COMMENTS"
export FAKE_PRS=$'14\tsteward/unknown-state\tdev'
run_sweep
check "an undetermined PR is neither merged nor commented"   "$(called pr-merge)" "0"
check "…no comment either — it is transient, not a finding"  "$(called pr-comment)" "0"
if grep -q 'mergeability undetermined' /tmp/steward-out.txt; then
  ok "…but the journal says it was skipped and why"
else bad "…the journal is silent about the skip"; fi

# ── 6. a server-side merge that fails after a green gate speaks too ─────────
: > "$FAKE_CALLS"; : > "$FAKE_COMMENTS"
export FAKE_PRS=$'15\tsteward/clean-green\tdev'
export FAKE_MERGE_FAILS=15
run_sweep
unset FAKE_MERGE_FAILS
check "a base that moved between gate and merge is reported" \
      "$(grep -c 'Steward janitor: cannot merge' "$FAKE_COMMENTS")" "1"
if grep -q 'merge FAILED after a green gate' /tmp/steward-out.txt; then
  ok "…and the journal no longer shrugs with \"(conflict?)\""
else bad "…the journal line is missing: $(cat /tmp/steward-out.txt)"; fi

printf '\n'
if [ "$fail" -eq 0 ]; then printf '\033[32mJANITOR SWEEP SELF-TEST PASS\033[0m — %s checks\n' "$pass"; exit 0; fi
printf '\033[31mJANITOR SWEEP SELF-TEST FAIL\033[0m — %s of %s failed\n' "$fail" "$((pass+fail))"; exit 1
