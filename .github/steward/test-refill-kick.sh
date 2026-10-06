#!/usr/bin/env bash
# test-refill-kick.sh — drive refill-kick.sh against a FAKE `gh` through every
# way a steward-improve run can end, and hold the workflow to the cap the script
# measures against.
#
# WHY (T-1711). A run cancelled at the 150-minute cap skipped the refill kick,
# so its slot waited 20-40 minutes for a cron tick. The cases below cover that
# cap cancel, a hand cancel (which must not kick), a failure (which still must
# not kick, per tech-sweep #106) and a success. The last block reads
# steward-improve.yml itself, because the cap this step passes in has to be the
# job's real `timeout-minutes`, and both have to keep calling this script.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SUT="$HERE/refill-kick.sh"
WF="$HERE/../workflows/steward-improve.yml"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
pass=0; fail=0
ok()  { printf '  \033[32mok\033[0m    %s\n' "$1"; pass=$((pass+1)); }
bad() { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; fail=$((fail+1)); }

mkdir -p "$TMP/bin"
cat > "$TMP/bin/gh" <<'FAKE'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FAKE_CALLS"
FAKE
chmod +x "$TMP/bin/gh"
export PATH="$TMP/bin:$PATH" FAKE_CALLS="$TMP/calls"

T0=1790000000
# case <label> <want: kick|quiet> <status> <elapsed minutes|-> [cap]
case_() {
  local label="$1" want="$2" status="$3" mins="$4" cap="${5:-150}" start
  : > "$FAKE_CALLS"
  if [ "$mins" = - ]; then start=''; else start="$T0"; fi
  local out; out=$(REFILL_NOW=$(( T0 + ${mins/-/0} * 60 )) bash "$SUT" "$status" "$start" "$cap" 2>&1)
  local calls; calls=$(wc -l < "$FAKE_CALLS")
  if [ "$want" = kick ]; then
    if [ "$calls" = 1 ] && grep -qx 'workflow run steward-focus.yml -R kevinrhaas/polecat-platform' "$FAKE_CALLS"; then ok "$label"
    else bad "$label — wanted one steward-focus dispatch, got $calls call(s): $out"; fi
  else
    if [ "$calls" = 0 ]; then ok "$label"; else bad "$label — wanted no dispatch, got: $(cat "$FAKE_CALLS")"; fi
  fi
}

echo "refill-kick.sh"
case_ "success kicks"                                   kick  success   48
case_ "cancelled at the cap (150m) kicks"               kick  cancelled 150
case_ "cancelled with post-steps past the cap kicks"    kick  cancelled 156
case_ "cancelled within the 10m margin (141m) kicks"    kick  cancelled 141
case_ "hand cancel at 139m stays quiet"                 quiet cancelled 139
case_ "hand cancel at 12m stays quiet"                  quiet cancelled 12
case_ "cancelled with no start stamp stays quiet"       quiet cancelled -
case_ "failure stays quiet (tech-sweep #106)"           quiet failure   150
case_ "an empty status stays quiet"                     quiet ''        150
case_ "the cap is a parameter: 90m cap, cancel at 85m"  kick  cancelled 85  90

echo "steward-improve.yml"
# The improve job's own cap: the first `timeout-minutes:` at job level (4 spaces).
job_cap=$(awk '/^  improve:/{j=1;next} j&&/^  [a-z]/{exit} j&&/^    timeout-minutes:/{print $2;exit}' "$WF")
step=$(awk '/- name: Free this slot/{s=1} s{print} s&&/bash .github.steward.refill-kick.sh/{exit}' "$WF")
step_cap=$(printf '%s\n' "$step" | sed -n 's/.*REFILL_CAP_MINUTES: *\([0-9]*\).*/\1/p')
if [ -n "$job_cap" ] && [ "$job_cap" = "$step_cap" ]; then ok "the refill step's cap ($step_cap) is the job's timeout-minutes ($job_cap)"
else bad "the refill step's cap ('$step_cap') is not the job's timeout-minutes ('$job_cap')"; fi
if printf '%s\n' "$step" | grep -q 'bash .github/steward/refill-kick.sh'; then ok "the refill step runs refill-kick.sh"; else bad "the refill step does not run refill-kick.sh"; fi
if printf '%s\n' "$step" | grep -q "job.status == 'cancelled'"; then ok "the refill step's if: admits a cancelled run"; else bad "the refill step's if: skips a cancelled run (T-1711)"; fi
if grep -q 'STEWARD_JOB_T0=' "$WF"; then ok "the job stamps its start for the refill step"; else bad "no STEWARD_JOB_T0 stamp in the workflow"; fi

echo; echo "$pass passed, $fail failed"
[ "$fail" = 0 ]
