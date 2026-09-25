#!/usr/bin/env bash
# gh-rest.sh — the steward's GitHub operations, on REST, with backoff.
#
#   gh-rest.sh pr-create   <repo> <head> <base> <title> <body-file>   → prints the PR number
#   gh-rest.sh pr-merge    <repo> <number> <method> [commit-title]    → prints the merge sha
#   gh-rest.sh pr-automerge <repo> <number> [method] [commit-title]   → 'armed', or merges now
#   gh-rest.sh pr-comment  <repo> <number> <body-file>
#   gh-rest.sh pr-list     <repo> [state] [per-page]                  → number<TAB>head<TAB>base<TAB>title
#   gh-rest.sh pr-get      <repo> <number> [--jq FILTER]
#   gh-rest.sh pr-resume   <repo> <number> --why "…" [--waits-on T-NNNN|nothing]
#   gh-rest.sh issue-create  <repo> <title> <body-file> [label]       → prints the issue number
#   gh-rest.sh issue-comment <repo> <number> <body-file>
#   gh-rest.sh issue-find    <repo> <label>                           → first open number, or empty
#   gh-rest.sh label-create  <repo> <name> <color> [description]
#   gh-rest.sh budget                                                 → both meters, one line
#
# WHY THIS EXISTS — two faults, measured on steward-improve run 1140
# (2026-08-27), and only one of them is about which endpoint you call.
#
#   1. THE WRONG METER. GitHub bills GraphQL and REST from SEPARATE hourly
#      buckets, and `gh pr create|merge|comment|view|list` and
#      `gh issue create|comment|list` all go through GraphQL. At 15:54:32Z that
#      run read:
#
#          graphql  remaining 0     of 5000   (used 6690)
#          core     remaining 4969  of 5000   (used 31)
#
#      `gh pr create` failed — "GraphQL: API rate limit already exceeded" — on a
#      unit of work that was finished, gated and pushed. It got its PR only
#      because the agent improvised the REST call by hand. GraphQL is metered in
#      POINTS by query complexity, not per call, so `used: 6690` is nowhere near
#      6,690 commands; five parallel slices exhaust it easily while REST idles.
#
#   2. BURST LIMITS, which REST does not escape. The same run read core at
#      **5000 remaining at 16:04:53Z** and then took a 403 "API rate limit
#      exceeded" on a core call at **16:05:30Z** — thirty-seven seconds later.
#      One agent cannot spend five thousand REST calls in thirty-seven seconds,
#      so that second 403 is a SECONDARY (abuse/burst) limit, which GitHub
#      applies to concurrency and burst rate regardless of quota. Moving to REST
#      would not have prevented it. Retrying, with the wait GitHub asks for,
#      does — and GitHub's own guidance is to honour `retry-after`.
#
# So every call here is REST *and* retried. Fixing only the endpoint would have
# left the second failure exactly where it was.
#
# Auth: inherits `gh`'s (GH_TOKEN in the workflows). No PAT of its own.
set -uo pipefail

MAX_ATTEMPTS="${GH_REST_ATTEMPTS:-5}"
CAP_SECONDS="${GH_REST_CAP_SECONDS:-120}"   # never sleep longer than this in one wait

log() { printf 'gh-rest: %s\n' "$*" >&2; }

# How long to wait before retrying, read from GitHub's own headers rather than
# guessed: `retry-after` (secondary limits) wins, then `x-ratelimit-reset` when
# the remaining count is actually zero (primary quota). Falls back to
# exponential backoff. Always capped — a run that sleeps for an hour has failed
# in a way nobody will watch.
wait_for() {
  local headers="$1" attempt="$2" retry_after reset remaining now delta
  retry_after=$(grep -i '^retry-after:' <<<"$headers" | tr -d '\r' | awk '{print $2}' | head -1)
  if [[ "$retry_after" =~ ^[0-9]+$ ]]; then
    echo $(( retry_after > CAP_SECONDS ? CAP_SECONDS : retry_after )); return
  fi
  remaining=$(grep -i '^x-ratelimit-remaining:' <<<"$headers" | tr -d '\r' | awk '{print $2}' | head -1)
  reset=$(grep -i '^x-ratelimit-reset:' <<<"$headers" | tr -d '\r' | awk '{print $2}' | head -1)
  if [[ "$remaining" == "0" && "$reset" =~ ^[0-9]+$ ]]; then
    now=$(date -u +%s); delta=$(( reset - now ))
    (( delta < 1 )) && delta=1
    echo $(( delta > CAP_SECONDS ? CAP_SECONDS : delta )); return
  fi
  delta=$(( 2 ** attempt ))
  echo $(( delta > CAP_SECONDS ? CAP_SECONDS : delta ))
}

# api <method> <path> [extra gh api args…]
#
# Retries ONLY on the statuses that mean "ask again later" — 403 carrying a rate
# limit, 429, and 5xx. A 403 that is a genuine permission failure, a 404 and a
# 422 are returned immediately: retrying them burns the very budget this script
# exists to protect, and hides the real error behind five identical failures.
api() {
  local method="$1" path="$2"; shift 2
  local attempt=1 out status headers body sleep_for
  while :; do
    out=$(gh api --include -X "$method" "$path" "$@" 2>&1)
    status=$(grep -m1 -oE '^HTTP/[0-9.]+ [0-9]{3}' <<<"$out" | awk '{print $2}')
    if [ -z "$status" ]; then
      # gh failed before it got an HTTP response at all (network, auth, bad args).
      if grep -qiE 'rate limit|secondary rate' <<<"$out" && (( attempt < MAX_ATTEMPTS )); then
        sleep_for=$(( 2 ** attempt )); (( sleep_for > CAP_SECONDS )) && sleep_for=$CAP_SECONDS
        log "rate limited (no response headers), attempt ${attempt}/${MAX_ATTEMPTS}, sleeping ${sleep_for}s"
        sleep "$sleep_for"; attempt=$(( attempt + 1 )); continue
      fi
      log "FAILED ${method} ${path}"; printf '%s\n' "$out" >&2; return 1
    fi
    headers=$(sed -n '1,/^\r*$/p' <<<"$out")
    body=$(sed '1,/^\r*$/d' <<<"$out")
    case "$status" in
      2*) printf '%s\n' "$body"; return 0 ;;
      403|429)
        if grep -qiE 'rate limit|secondary rate|abuse' <<<"$body" && (( attempt < MAX_ATTEMPTS )); then
          sleep_for=$(wait_for "$headers" "$attempt")
          log "HTTP ${status} rate limited, attempt ${attempt}/${MAX_ATTEMPTS}, sleeping ${sleep_for}s — ${method} ${path}"
          sleep "$sleep_for"; attempt=$(( attempt + 1 )); continue
        fi
        log "HTTP ${status} (not a rate limit, or attempts exhausted) — ${method} ${path}"
        printf '%s\n' "$body" >&2; return 1 ;;
      5*)
        if (( attempt < MAX_ATTEMPTS )); then
          sleep_for=$(( 2 ** attempt )); (( sleep_for > CAP_SECONDS )) && sleep_for=$CAP_SECONDS
          log "HTTP ${status}, attempt ${attempt}/${MAX_ATTEMPTS}, sleeping ${sleep_for}s"
          sleep "$sleep_for"; attempt=$(( attempt + 1 )); continue
        fi
        log "HTTP ${status} after ${MAX_ATTEMPTS} attempts — ${method} ${path}"
        printf '%s\n' "$body" >&2; return 1 ;;
      *)
        log "HTTP ${status} — ${method} ${path}"; printf '%s\n' "$body" >&2; return 1 ;;
    esac
  done
}

jqf() { python3 -c 'import json,sys;d=json.load(sys.stdin);print(d.get(sys.argv[1],"") if isinstance(d,dict) else "")' "$1"; }

cmd="${1:-}"; shift || true
case "$cmd" in
  pr-create)
    repo="$1"; head="$2"; base="$3"; title="$4"; bodyfile="$5"
    payload=$(python3 -c '
import json,sys
json.dump({"title":sys.argv[1],"head":sys.argv[2],"base":sys.argv[3],
           "body":open(sys.argv[4],encoding="utf-8").read()}, sys.stdout)' \
      "$title" "$head" "$base" "$bodyfile")
    printf '%s' "$payload" > /tmp/gh-rest-pr.json
    api POST "repos/${repo}/pulls" --input /tmp/gh-rest-pr.json | jqf number ;;
  pr-merge)
    repo="$1"; number="$2"; method="${3:-squash}"; ctitle="${4:-}"
    payload=$(python3 -c '
import json,sys
d={"merge_method":sys.argv[1]}
if len(sys.argv)>2 and sys.argv[2]: d["commit_title"]=sys.argv[2]
json.dump(d,sys.stdout)' "$method" "$ctitle")
    printf '%s' "$payload" > /tmp/gh-rest-merge.json
    api PUT "repos/${repo}/pulls/${number}/merge" --input /tmp/gh-rest-merge.json | jqf sha ;;
  pr-automerge)
    # Arm GitHub's auto-merge, so the PR lands the moment its required checks go
    # green and nobody has to hold a run open watching for it. Falls back to an
    # ordinary merge whenever auto-merge cannot be armed, so it is never worse
    # than `pr-merge` — the caller can always use this instead.
    #
    # THIS IS THE ONE GraphQL CALL IN THIS FILE, and the header's rule is being
    # applied rather than bent. `enablePullRequestAutoMerge` has NO REST
    # endpoint; there is no other way to arm it. What emptied the meter on run
    # 1140 was `gh pr view|list|create`, which fetch nested objects and are
    # billed by COMPLEXITY — that is why `used: 6690` was nowhere near 6,690
    # commands. This is one mutation against one object, once per unit of work:
    # five slices spend about five points of five thousand an hour. `gh pr ...`
    # stays forbidden; a single priced mutation is not what ran the meter down.
    #
    # WHY IT IS WORTH THE POINT. Without it a run must either sit through its
    # own PR's checks — minutes of a capped slice, spent waiting — or merge
    # before they finish. And the base branch moves underneath it meanwhile:
    # eleven merge attempts were lost to that on 2026-09-05, each one a rebuild
    # and a gate, because `dev` advanced between the push and the merge.
    repo="$1"; number="$2"
    method=$(printf '%s' "${3:-squash}" | tr '[:lower:]' '[:upper:]')
    node=$(api GET "repos/${repo}/pulls/${number}" | jqf node_id)
    if [ -z "$node" ]; then
      log "pr-automerge: could not read the PR's node id — merging directly instead"
      bash "$0" pr-merge "$repo" "$number" "${3:-squash}" "${4:-}"; exit $?
    fi
    # One line on purpose: the test harness logs one line per call, so a query
    # broken over six lines reads as six calls and the "how many requests did
    # this cost" assertion — the whole point of this file — stops meaning anything.
    out=$(gh api graphql -f query='mutation($id:ID!, $m:PullRequestMergeMethod!) { enablePullRequestAutoMerge(input:{pullRequestId:$id, mergeMethod:$m}) { pullRequest { number autoMergeRequest { enabledAt } } } }' -f id="$node" -f m="$method" 2>&1)
    if [ $? -eq 0 ] && ! grep -qi '"errors"\|GraphQL:' <<<"$out"; then
      log "pr-automerge: armed on ${repo}#${number} (${method}) — GitHub will merge it when the gate is green"
      printf 'armed\n'; exit 0
    fi
    # The three ways it legitimately cannot arm, all of which mean "just merge":
    #   • "Pull request is in clean status" — nothing left to wait for.
    #   • auto-merge not enabled on the repository.
    #   • no required status check on the base branch, so a clean PR is
    #     immediately mergeable and GitHub refuses to queue it.
    log "pr-automerge: could not arm (${out//$'\n'/ }) — merging directly instead"
    bash "$0" pr-merge "$repo" "$number" "${3:-squash}" "${4:-}" ;;
  pr-comment|issue-comment)
    repo="$1"; number="$2"; bodyfile="$3"
    python3 -c 'import json,sys;json.dump({"body":open(sys.argv[1],encoding="utf-8").read()},sys.stdout)' \
      "$bodyfile" > /tmp/gh-rest-comment.json
    api POST "repos/${repo}/issues/${number}/comments" --input /tmp/gh-rest-comment.json >/dev/null ;;
  pr-list)
    repo="$1"; state="${2:-open}"; per="${3:-50}"
    api GET "repos/${repo}/pulls?state=${state}&per_page=${per}" \
      | python3 -c '
import json,sys
for p in json.load(sys.stdin):
    print("\t".join([str(p["number"]), p["head"]["ref"], p["base"]["ref"], p["title"]]))' ;;
  pr-get)
    repo="$1"; number="$2"; shift 2
    api GET "repos/${repo}/pulls/${number}" "$@" ;;
  pr-sweepable)
    # What the janitor asks for, in ONE request: open, not draft, not `hold`,
    # head matching <regex>. REST's pull list already carries draft, labels,
    # head.ref AND base.ref, so this also retires the per-PR `gh pr view` the
    # janitor used to make just to learn the branch name — one call per PR
    # saved, on top of the bucket change.
    #
    # `hold` IS THE ONLY LABEL THAT TAKES A PR OUT OF THE SWEEP, and `resume` is
    # deliberately NOT one of them (T-1577). The two labels mean different
    # things: `hold` is the owner deciding, so nothing comes for it until he says
    # so; `resume` is a run's own unfinished handoff, which is work the loop
    # still owes and therefore exactly what this sweep is for. A resumable PR is
    # lapped, gated and merged like any other, and the test below asserts both
    # halves so a future filter cannot quietly silence the second one.
    #
    # The BASE is the third column, added for T-0809: the janitor merges the
    # base into the branch and gates THAT, so it has to know which base. It
    # cannot assume `main` — jobtracker, analytics and chicago/4d are all on a
    # dev-first pipeline and their automation PRs target `dev`.
    repo="$1"; pattern="$2"
    api GET "repos/${repo}/pulls?state=open&per_page=100" \
      | python3 -c '
import json,re,sys
pat=re.compile(sys.argv[1])
for p in json.load(sys.stdin):
    if p.get("draft"): continue
    if any(l["name"]=="hold" for l in p.get("labels",[])): continue
    ref = p["head"]["ref"]
    if not pat.search(ref): continue
    print("%d\t%s\t%s" % (p["number"], ref, p["base"]["ref"]))' "$pattern" ;;
  pr-resume)
    # THE RUN'S OWN UNFINISHED WORK, HANDED TO THE NEXT RUN — the verb that
    # replaced `hold` in a steward run's hands (T-1577; chicago/4d AGENTS.md
    # § the two labels is the fleet statement of it).
    #
    #   `hold` means THE OWNER IS DECIDING, and every automated pass skips a held
    #   PR on purpose — a park a robot can overrule is not a park. The steward
    #   prompt used to tell a run to apply that same label when it merely could
    #   not finish, so work that needed nobody's decision had nothing coming for
    #   it either. Measured 2026-09-25 on chicago's three open PRs: #39's stated
    #   reason was already stale (CI had since passed all 620 steps) and it had
    #   drifted into conflict while held; #41 and #42 were COMPLETE, held only
    #   because dev's gate was red. Not one needed a ruling; each needed a
    #   machine to lap it, re-gate it and merge it, and each got a person.
    #
    # So: a run never applies `hold`, and this is what it applies instead.
    repo="$1"; number="$2"; shift 2
    why=""; waits="nothing"
    while [ $# -gt 0 ]; do
      case "$1" in
        --why)      why="$2"; shift 2 ;;
        --waits-on) waits="${2:-nothing}"; shift 2 ;;
        *) echo "gh-rest.sh pr-resume: unknown argument $1" >&2; exit 2 ;;
      esac
    done
    # A HANDOFF WITH NO REASON IS THE FAULT THIS VERB EXISTS TO END, so a missing
    # reason is a usage error and not a default. The three PRs above each had a
    # reason; it was in the PR body, which is the one place nobody reads.
    [ -n "$why" ] || { echo "gh-rest.sh pr-resume: --why is required — a handoff whose reason is not written down is the fault this verb exists to end" >&2; exit 2; }
    # ONE LINE, ALWAYS. A newline in the reason would push the machine-readable
    # part off the first line, and every reader below would see a handoff with no
    # reason — the same silence, wearing a new label.
    why=$(printf '%s' "$why" | tr '\n\r\t' '   ')
    [ -n "$waits" ] || waits=nothing
    case "$waits" in
      nothing|T-[0-9][0-9][0-9][0-9]) ;;
      *) echo "gh-rest.sh pr-resume: --waits-on takes a ticket id like T-1567, or the word 'nothing' — got '$waits'" >&2; exit 2 ;;
    esac
    # The label vocabulary, created once and idempotently. Adding a label that
    # does not exist is a 422 on the issues endpoint, so the first handoff in a
    # repo that has never seen one would otherwise leave the comment and no label
    # — visible to a person and invisible to every pass.
    bash "$0" label-create "$repo" resume 0E8A16 \
      "A run could not finish this; the next one picks it up — reason in the resume: comment"
    # THE REASON GOES ON BEFORE THE LABEL, and the order is the point: a labelled
    # PR must never exist without its reason beside it. If the comment fails the
    # label is never applied and the run is told — better an unlabelled PR with a
    # loud failure than a labelled one nobody can interpret.
    {
      printf 'resume: %s · waits on: %s\n\n' "$why" "$waits"
      printf 'This pull request is the loop'"'"'s own unfinished work, and it is NOT parked.\n'
      printf 'The run that opened it could not finish inside its own budget; the branch\n'
      printf 'carries the work. A later run picks it up before it takes new queue work:\n'
      printf 'merge the base in, re-derive, fix what is red, gate, merge. The janitor\n'
      printf 'keeps sweeping it in the meantime — `resume` is work the loop still owes.\n\n'
      if [ "$waits" != "nothing" ]; then
        printf 'It waits on **%s**. Until that ticket closes this PR cannot go green, so an\n' "$waits"
        printf 'agentic run that finds it says so and takes the next row rather than\n'
        printf 're-gating it. A machine merge of an already-green PR is not gated by this.\n\n'
      fi
      printf '`hold` is the owner'"'"'s park switch and no run applies it.\n\n'
      printf -- '---\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n'
    } > /tmp/gh-rest-resume.md
    bash "$0" pr-comment "$repo" "$number" /tmp/gh-rest-resume.md
    api POST "repos/${repo}/issues/${number}/labels" -f 'labels[]=resume' >/dev/null
    # AND `hold` COMES OFF. A run reaching for this verb is declaring the work
    # unfinished, not parked; leaving both on would leave every pass skipping it,
    # which is exactly the state being fixed. A PR that never had `hold` answers
    # 404 here, and that is not a failure.
    api DELETE "repos/${repo}/issues/${number}/labels/hold" >/dev/null 2>&1 \
      && echo "  hold removed — hold is the owner's switch and no run applies it"
    echo "resume: #${number} handed off · waits on: ${waits}" ;;
  pr-state)
    # `open` or `closed`, one field, one REST request. The janitor asks this
    # AFTER a gate that can run for minutes, so it does not merge a pull request
    # that was closed while that gate ran — see steward-janitor.yml for the run
    # that made it necessary.
    #
    # IT PRINTS NOTHING WHEN THE REQUEST FAILS, and exits 0 while doing it. That
    # is the contract the caller is written against: an empty answer means
    # "could not tell", and the caller carries on and merges, which is what it
    # did before this existed. Returning non-zero would put a REST hiccup in the
    # path of every merge in the fleet, and this is a guard against one bad
    # merge, not a safety interlock worth paying that for.
    repo="$1"; number="$2"
    body=$(api GET "repos/${repo}/pulls/${number}") || {
      log "pr-state: could not read ${repo}#${number} — answering empty"; exit 0; }
    printf '%s' "$body" | jqf state ;;
  pr-find)
    # Open PR number for a head branch, or empty. `head` must be qualified with
    # the owner — GitHub's REST filter takes `owner:branch` and silently matches
    # nothing when given a bare branch name, which would read as "no PR exists"
    # and is exactly the wrong answer for a caller checking whether its push
    # got one.
    repo="$1"; branch="$2"; owner="${repo%%/*}"
    api GET "repos/${repo}/pulls?state=open&head=${owner}:${branch}&per_page=1" \
      | python3 -c '
import json,sys
d=json.load(sys.stdin)
print(d[0]["number"] if d else "")' ;;
  comments-list)
    # Issue and PR comments share one REST collection.
    repo="$1"; number="$2"
    api GET "repos/${repo}/issues/${number}/comments?per_page=100" \
      | python3 -c '
import json,sys
for c in json.load(sys.stdin): print(c.get("body",""))' ;;
  branch-delete)
    # `gh pr merge --delete-branch` did this as part of a GraphQL call; on REST
    # it is its own ref deletion. Never fatal — a branch already gone, or one
    # protected, must not fail a merge that already succeeded.
    repo="$1"; branch="$2"
    api DELETE "repos/${repo}/git/refs/heads/${branch}" >/dev/null 2>&1 || true ;;
  issue-create)
    repo="$1"; title="$2"; bodyfile="$3"; label="${4:-}"
    python3 -c '
import json,sys
d={"title":sys.argv[1],"body":open(sys.argv[2],encoding="utf-8").read()}
if len(sys.argv)>3 and sys.argv[3]: d["labels"]=[sys.argv[3]]
json.dump(d,sys.stdout)' "$title" "$bodyfile" "$label" > /tmp/gh-rest-issue.json
    api POST "repos/${repo}/issues" --input /tmp/gh-rest-issue.json | jqf number ;;
  issue-find)
    repo="$1"; label="$2"
    api GET "repos/${repo}/issues?state=open&labels=${label}&per_page=1" \
      | python3 -c '
import json,sys
d=json.load(sys.stdin)
print(d[0]["number"] if d else "")' ;;
  label-create)
    repo="$1"; name="$2"; color="$3"; desc="${4:-}"
    python3 -c '
import json,sys
json.dump({"name":sys.argv[1],"color":sys.argv[2],"description":sys.argv[3]},sys.stdout)' \
      "$name" "$color" "$desc" > /tmp/gh-rest-label.json
    # A label that already exists is a 422, which is success for our purposes.
    api POST "repos/${repo}/labels" --input /tmp/gh-rest-label.json >/dev/null 2>&1 || true ;;
  budget)
    # All THREE pools. Reporting core+graphql only repeated the mistake this
    # file exists to correct — a meter that omits a pool reads "fine" during the
    # outage that pool is causing. Free to call: /rate_limit is not itself
    # metered.
    gh api rate_limit --jq \
      '"core \(.resources.core.remaining)/\(.resources.core.limit)  graphql \(.resources.graphql.remaining)/\(.resources.graphql.limit)  search \(.resources.search.remaining)/\(.resources.search.limit)"' ;;
  *)
    sed -n '2,15p' "$0" >&2; exit 2 ;;
esac
