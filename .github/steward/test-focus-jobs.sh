#!/usr/bin/env bash
# test-focus-jobs.sh — a roster JOB is dispatched once, not once per tick.
#
# The body is not copied here: it is EXTRACTED from
# .github/workflows/steward-focus.yml, so this tests the shipped code, and it is
# extracted under `set -euo pipefail` because that is how GitHub runs a `run:`
# block (`bash -e {0}`, which the runner prints in every log). Running the step
# under different shell options than production is how the janitor's own suite
# stayed green through 23 consecutive failures — see test-janitor-sweep.sh.
#
# WHAT IT GUARDS. `schedule.mjs isDueAt` is HOUR-GRANULAR: it asks
# `hour % everyHours == offset` and remembers nothing about whether the job has
# already run this hour. The focus cron is `*/10`, so a due hour is due at all
# six of its ticks. The app lanes absorb that — they count busy slices and fill
# only free slots — but the job loop dispatched unconditionally.
#
# Measured 2026-09-14 on kevinrhaas/polecat-platform, once the janitor began
# taking real time instead of dying in 1.5 seconds:
#
#   1044  created 02:41:44   cancelled 02:52:29   ← when 1045 arrived
#   1045  created 02:52:27   cancelled 03:03:21   ← when 1046 arrived
#   1046  created 03:03:18   cancelled 03:17:38   ← when 1047 arrived
#
# Each was superseded as the pending member of the janitor's concurrency group
# by the next dispatch, so no sweep ever finished — and `custom` is LAST in the
# janitor's FLEET, so the repo with the backlog was never reached at all.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WF="$HERE/../workflows/steward-focus.yml"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
pass=0; fail=0
ok()   { printf '  \033[32mok\033[0m    %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; fail=$((fail+1)); }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 — expected [$3], got [$2]"; fi; }

# ── extract the dispatch step, verbatim ──────────────────────────────────────
python3 - "$WF" "$TMP/focus.sh" <<'PY'
import sys, yaml
wf, out = sys.argv[1], sys.argv[2]
steps = [s for j in yaml.safe_load(open(wf))['jobs'].values() for s in j['steps']]
body = [s for s in steps if 'due-jobs' in (s.get('run') or '')]
assert len(body) == 1, f'expected one step that dispatches roster jobs, found {len(body)}'
open(out, 'w').write("#!/usr/bin/env bash\nset -euo pipefail\n" + body[0]['run'])
PY
[ -s "$TMP/focus.sh" ] || { echo "could not extract the dispatch step"; exit 1; }
bash -n "$TMP/focus.sh" || { echo "the extracted dispatch body does not parse"; exit 1; }

# ── the fakes ────────────────────────────────────────────────────────────────
# Only `gh` and `node schedule.mjs` reach outside, so faking both on PATH is a
# whole world for the step to be wrong in. No repository is contacted.
BIN="$TMP/bin"; mkdir -p "$BIN"; export PATH="$BIN:$PATH"
export GH_TOKEN=fake
export FAKE_DISPATCHES="$TMP/dispatches"

cat > "$BIN/gh" <<'FAKE'
#!/usr/bin/env bash
case "$2" in
  list)
    # `gh run list --json status,createdAt` — the step reads BOTH gates off this
    # one call, so the fake answers with the JSON shape gh really returns.
    # FAKE_BUSY runs are in_progress; FAKE_LAST_AGE_MIN dates the newest run.
    if [ "${FAKE_GH_BROKEN:-}" = "1" ]; then echo "gh: could not query" >&2; exit 1; fi
    python3 - <<PYEOF
import json, os, datetime as dt
busy = int(os.environ.get("FAKE_BUSY", "0") or 0)
age  = os.environ.get("FAKE_LAST_AGE_MIN", "")
rows = [{"status": "in_progress", "createdAt": dt.datetime.now(dt.timezone.utc).isoformat()}
        for _ in range(busy)]
if age != "":
    when = dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=int(age))
    rows.append({"status": "completed", "createdAt": when.isoformat().replace("+00:00", "Z")})
print(json.dumps(rows))
PYEOF
    ;;
  run)
    # `gh workflow run <wf> …` — record what would have been dispatched.
    printf '%s\n' "$3" >> "$FAKE_DISPATCHES" ;;
esac
FAKE
chmod +x "$BIN/gh"

# schedule.mjs is replaced wholesale: this suite is about the DISPATCH rule, and
# schedule.mjs has its own behaviour. `due-jobs` says janitor is due; the app
# loop above is given nothing to do.
mkdir -p "$TMP/ws/.github/steward"
cat > "$TMP/ws/.github/steward/schedule.mjs" <<'FAKE'
const cmd = process.argv[2];
if (cmd === 'due-jobs') console.log('janitor');
else if (cmd === 'due') process.exit(0);
else if (cmd === 'slices-of') console.log('1');
// The cadence the age gate reads. FAKE_EVERY_HOURS lets a case choose it; 0
// means "the roster does not hold this job", which must disable the gate rather
// than block the job forever.
else if (cmd === 'every-hours-of-job') console.log(process.env.FAKE_EVERY_HOURS || '1');
else console.log('');
FAKE
cp "$TMP/focus.sh" "$TMP/ws/focus.sh"

run_focus() { : > "$FAKE_DISPATCHES"; ( cd "$TMP/ws" && bash focus.sh ) > "$TMP/log" 2>&1; }
# `grep -c` PRINTS 0 and EXITS 1 on no match, so `|| echo 0` emits TWO zeros and
# every comparison against "0" fails. `|| true` keeps the count it already
# printed and only swallows the status.
dispatched() { grep -c 'steward-janitor.yml' "$FAKE_DISPATCHES" 2>/dev/null || true; }

echo "steward-focus.yml — a roster job is dispatched once, not once per tick"

# ── 1. nothing in flight: the job is dispatched ──────────────────────────────
export FAKE_BUSY=0
run_focus
check "an idle janitor is dispatched" "$(dispatched)" "1"

# ── 2. THE FAULT: a run already in flight must not be dispatched over ────────
export FAKE_BUSY=1
run_focus
check "a janitor already running is NOT dispatched again" "$(dispatched)" "0"
if grep -q 'already in flight' "$TMP/log"; then
  ok "…and the tick says why it skipped"
else bad "…the tick is silent about the skip: $(cat "$TMP/log")"; fi

# ── 3. queued counts as busy too — that is the run that was being cancelled ──
export FAKE_BUSY=2
run_focus
check "a queued run counts as in flight" "$(dispatched)" "0"

# ── 4. the query failing must not silence the job for an hour ────────────────
export FAKE_BUSY=0 FAKE_GH_BROKEN=1
run_focus
check "a broken gh query fails OPEN and still dispatches" "$(dispatched)" "1"
unset FAKE_GH_BROKEN

# ── 5. THE CADENCE ITSELF (T-1125) — everyHours is hours, not ticks ─────────
# `isDueAt` is hour-granular, so everyHours:1 is true at EVERY tick. For an app
# lane that is the point; for a job it means "as often as the cron fires", which
# on 2026-09-14 was about every eight minutes. The age gate is what turns the
# Manager dial into a cadence.
export FAKE_BUSY=0 FAKE_EVERY_HOURS=1
export FAKE_LAST_AGE_MIN=20
run_focus
check "a job that ran 20m ago is NOT redispatched on an hourly cadence" "$(dispatched)" "0"
if grep -q 'cadence is every 1h' "$TMP/log"; then
  ok "…and the tick says how long ago and what the cadence is"
else bad "…the skip is unexplained: $(cat "$TMP/log")"; fi

export FAKE_LAST_AGE_MIN=75
run_focus
check "…and IS redispatched once the hour has passed"                  "$(dispatched)" "1"

# A coarser cadence holds for longer off the same measurement.
export FAKE_EVERY_HOURS=2 FAKE_LAST_AGE_MIN=75
run_focus
check "75m is not due on a 2h cadence"                                 "$(dispatched)" "0"
export FAKE_LAST_AGE_MIN=130
run_focus
check "…but 130m is"                                                   "$(dispatched)" "1"

# ── 6. the age gate fails OPEN, exactly as the busy check does ──────────────
# A job silenced forever by an unanswerable query is worse than one dispatched
# twice, and a job the roster does not hold must not be gated at all.
export FAKE_EVERY_HOURS=1; unset FAKE_LAST_AGE_MIN
run_focus
check "no run history at all still dispatches"                         "$(dispatched)" "1"
export FAKE_EVERY_HOURS=0 FAKE_LAST_AGE_MIN=5
run_focus
check "a job the roster does not hold is not age-gated"                "$(dispatched)" "1"
unset FAKE_EVERY_HOURS FAKE_LAST_AGE_MIN

printf '\n'
if [ "$fail" -eq 0 ]; then printf '\033[32mFOCUS JOB DISPATCH SELF-TEST PASS\033[0m — %s checks\n' "$pass"; exit 0; fi
printf '\033[31mFOCUS JOB DISPATCH SELF-TEST FAIL\033[0m — %s of %s failed\n' "$fail" "$((pass+fail))"; exit 1
