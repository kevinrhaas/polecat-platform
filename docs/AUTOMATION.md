# Automation Playbook — the steward runs on GitHub Actions

## Division of labor

**GitHub Actions are the whole spine now** — both the deterministic plumbing AND the
agentic steward jobs. (We tried Claude Code Remote routines first; see the post-mortem
below.)

**Deterministic plumbing** (per app repo, boring and proven):
- `deploy.yml` — Pages deploy on push to main. Merge IS ship.
- Smoke tests — Playwright at 390×780 + desktop, zero pageerrors. ADVISORY only:
  **never hard-gate deploy on CI** (a `needs: test` gate once froze analytics ~21h).
  Self-healing beats gating: `auto-revert.yml` ("Guard main") reverts a broken main.
- `archive-release.mjs` — frozen `/v/<n>/` snapshots + `releases.json` (jobtracker/
  autoselector pattern; adopt fleet-wide as apps migrate).
- `sync-shell.yml` (this repo) — opens vendoring PRs to app repos.
- `self-improve.yml` in app repos — dispatch-only fallback (schedules stay commented).
  @claude mention workflows stay.

**The steward jobs** (this repo, `.github/workflows/steward-*.yml`, prompts in
`.github/steward/*.md`):

| Workflow | Schedule | Job |
|---|---|---|
| `steward-improve.yml` | dispatch-only (no schedule) | ONE unit of work on the app that most needs it — shell PRs first, then the MIGRATION.md queue, then stalest-release playbook work. Invoked by `steward-focus.yml` per `focus.json` with an explicit `app=<repo>` (focus mode); a manual dispatch with an empty `app` runs the suite-wide fleet pick. **All scheduling lives in `focus.json`** — the `STEWARD_FOCUS_APP` variable was retired (2026-07-15). |
| `steward-focus.yml` | heartbeat tick every 10 min (`*/10`, Claude-free) | **The multi-app focus roster.** Reads `.github/steward/focus.json` through `.github/steward/schedule.mjs` (the canonical evaluator) and, each tick, **tops up** every enabled lane that is due. Lane schedule fields: `enabled`, `everyHours`, `offset` (align which hours the cadence lands on), `window` (UTC hour window, wraps midnight), `startAt` (sleep until), `until` (expire at — "run every X until Y"), `slices` (1..10, default 1). **`slices` is a standing CONCURRENCY TARGET, not a batch size** (changed 2026-09): the lane keeps N improve runs going at all times, each a full unit of work with its own PR + smoke gate. Each tick counts how many of the N slots are occupied and dispatches only the empty ones, so one run finishing frees one slot and one replacement starts while its siblings carry on. The refill reuses that slot's OWN number (`slice=k`), which matters twice: the slice index is part of `steward-improve`'s concurrency group (`…-s<k>`), and slice k takes the **k-th** topmost workable item — stable because a claimed item keeps its place in the list (see `.github/steward/improve.md` § PARALLEL SLICES; chicago/4d additionally locks per-ticket via `tools/ticket.mjs claim`/`inflight`). This replaced a BATCH GATE that fired all N and then skipped the lane until every one had finished — so a lane moved at the pace of its slowest run, and one set to 10 spent much of its time running one. Before that it chained one-at-a-time, only because all slices shared a concurrency group that holds one running + one pending and cancelled the surplus. For continuous operation keep `everyHours: 1`, which makes the lane eligible on every tick. **The loop does not depend on the cron:** every successful run dispatches `steward-focus` itself (its final step), so a freed slot refills within about a minute. That matters because GitHub throttles schedule events hard under load — measured 2026-08-27, ticks arrived 99–214 minutes apart and then stopped for ~6 hours. The cron is a backstop, and the recovery path for a slot freed by a run that FAILED (the kick is gated on success). A lowered `slices` is honoured by letting the surplus drain, never by cancelling it. Different apps run in parallel, and so do a lane's own slices. Edit lanes from Manager's Fleet Ops panel, the GitHub UI, or any session — no workflow edits needed, and effective AT ONCE: a push to focus.json ticks steward-focus (its `push` trigger), which is what makes enabling a lane start it instead of leaving it to wait on a throttled cron. That cold start was the one path back to full strength with no finishing run to do the kicking. Preview with `node .github/steward/schedule.mjs next`. |
| `steward-sweep-ux.yml` | roster job `sweep-ux` (default daily, 06 UTC) | Read-only user walk of every live site → one prioritized findings issue per app. |
| `steward-sweep-tech.yml` | roster job `sweep-tech` (default daily, 09 UTC) | Read-only audit: pageerrors, changelog contract, vendor sha256 drift, SW caches, CI health, hygiene, secrets → one issue per app. |
| `steward-janitor.yml` | roster job `janitor` (default every 2h; Claude-free) | **The no-manual-merges guarantee.** Sweeps all fleet repos for open `steward/*` / `chore/polecat-shell-*` PRs, merges each PR's **base** into its branch, re-runs each app's own smoke gate against **that merge**, merges the green ones, comments once on the red ones. Never touches drafts or PRs labeled `hold` — that label is Kevin's park-for-review switch, and since T-1577 **no run applies it**. A PR labeled `resume` IS swept: that is a run's own unfinished handoff, which is work the loop still owes, so the janitor laps, gates and merges it like any other (see the two-label table in `.github/steward/improve.md` and the fixture in `test-gh-rest.sh`). **It gates the merge, not the bare branch, and it says so when a branch will not merge** — both since T-0809 (2026-09-13). Before that it cloned the branch alone: a green branch was merged without the merge ever having been gated (the hole T-0674 filed against bot-opened PRs), and a merge that then failed on conflict printed `merge failed (conflict?)` and moved on — no comment, no label. That silence is how 21 automation PRs silted up on kevinrhaas/custom in 2026-09, each swept and skipped and swept again; measured again on the day of the fix, **all five** open ones conflicted (on `changelog.js`, `QUEUE.md` and `dev-smoke-state.json` — files that repo deliberately does not union-merge) and not one had been told. **The standing rule: a `steward/*` PR that cannot merge is not open, it is ROTTING** — its ticket still reads `open` at the top of the queue and the next slice rebuilds the same work, so an un-mergeable PR must become visible within one sweep. `.github/steward/janitor-mergeability.sh` puts the merge on disk or names the conflicting paths; `test-janitor-sweep.sh` gates both failure paths in `ci.yml` by **extracting** the sweep step from the workflow, so editing the workflow is what that check watches. **It should not be inheriting GREEN work, and since T-1609 (2026-09-26) it mostly does not.** `pr-automerge`'s wait for a pending gate defaulted to 420 s against a chicago gate measured at 502-583 s, so a finished, foreground-gated unit timed out and became a `resume` PR every time — PR #60 was then merged *unchanged* by this sweep an hour later. The wait is now 540 s (the most one 600 s foreground call can hold), it reads the gate **at** its deadline rather than a poll short of it, and a still-pending gate is no longer reported as a refusal: it exits **4** with the PR untouched, and the run laps it once more and merges in-run. A RED check still exits 3 and still labels `resume`, which is the case this sweep is genuinely for. |
| `steward-shell-release.yml` | dispatch only | Bump lib/VERSION + manifest + tag, vendoring PRs to every app, merge the green ones. |

The sweeps' and janitor's standalone crons are retired (2026-07-16): **focus.json is
the single scheduler** — its `jobs` section (`fleet-improve`, `sweep-ux`,
`sweep-tech`, `janitor`) uses the same lane fields as app lanes (cadence, offset,
window, startAt, until) and is edited the same ways, including Manager's Fleet Ops
panel. `fleet-improve` schedules the suite-wide steward pick (off by default).

Secrets required on THIS repo: `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`)
and `STEWARD_PAT` (classic PAT, repo scope on kevinrhaas/* — powers cross-repo
clone/push and `gh` PRs/issues). Every workflow fails fast with a clear error if
either is missing.

### Which token pays for a call

Two tokens, two meters, and the rule is simply *where the call lands*:

| | reaches | metered | use for |
|---|---|---|---|
| `STEWARD_PAT` | every `kevinrhaas/*` repo | **account-wide** — one pool shared by every parallel slice, the janitor, the sweeps AND Manager's Fleet Ops | anything touching an APP repo |
| `${{ github.token }}` | this repo only | **per repository** (1,000/h), its own bucket | anything that stays in polecat-platform |

The PAT's pool is the scarce one, and `slices: N` multiplies the demand on it by
N. So a call that never leaves this repo should not be paid for out of it:

- **Journalling** (`journal.sh`, which hardcodes `kevinrhaas/polecat-platform`)
  runs on `github.token` in improve, janitor and both sweeps — each needs
  `issues: write`. This also makes the write-up independent of PR traffic: a
  starved PAT can no longer lose a shipped run's journal entry.
- **Dispatch** (steward-focus firing improve, and a finishing run kicking
  steward-focus to refill its slot) runs on `github.token` with `actions: write`. Safe despite the
  "GITHUB_TOKEN events don't start workflow runs" rule, because
  `workflow_dispatch` is an explicit exception to it.
- Everything cross-repo — clone/push, PRs and issues on app repos, the
  chicago/4d blender pin — stays on the PAT. It has no alternative.

Two things that are NOT the REST pool, and mislead if you assume they are:
git over HTTPS (clone/fetch/push) is metered separately and does not spend it,
and **GraphQL has its own 5,000-point hourly bucket** — which `gh pr` and
`gh issue` used to drain to zero while REST sat nearly untouched (see the
measurement in `.github/steward/gh-rest.sh`, the reason those calls are now
REST). `bash .github/steward/gh-rest.sh budget` prints core and GraphQL
together.

Optional secrets — per-app admin tokens: `MANAGER_ADMIN_TOKEN`,
`ANALYTICS_ADMIN_TOKEN`, `JOBTRACKER_ADMIN_TOKEN`, `RELAY_ADMIN_TOKEN`,
`MODELSERVER_ADMIN_TOKEN`. Each unlocks that app's client-side invite/admin
gate (lib/access.js pattern) so the UX sweep and focused improve runs can
exercise the real UI; any that are absent leave that gate closed and the run
audits the gate screen + repo source instead, saying so. The prompts forbid
ever echoing a token's value into issues, PRs, commits, or logs. These gates
are UX gating, not security (the apps are public static sites), so the tokens
are low-sensitivity — but treat them as secrets anyway.

**The Steward journal** (2026-07-17): every steward run finishes by posting what it
did — the Claude jobs' printed summaries, the janitor's action list — as a comment
on the always-open `Steward journal` issue (label `steward-journal`, posted by
`.github/steward/journal.sh`, tagged `<!-- steward-run:ID -->`). Manager's Fleet Ops
matches the tag to show each run's narrative in its in-panel review. Don't close the
issue; a new one is auto-created if it goes missing.

**The journal rolls over, and it never fails a run** (2026-09-27). GitHub refuses a
comment on an issue that already has 2,500 (HTTP 403, *"Commenting is disabled on issues
with more than 2500 comments"*). The first journal, #56, got there at 12:27Z that day.
Every janitor run then went red on its journal step alone, after its sweep had finished.
The improve runs, which mark the step `continue-on-error`, stayed green and silently lost
every entry, so Fleet Ops' run review showed nothing new. `journal.sh` now reads the
issue's comment count first (`gh-rest.sh issue-comments`). At `JOURNAL_ROLL_AT` (2,400)
it opens a successor journal pointing back at the full one, then closes the full one, so
there is never a moment with none open. A post refused for the cap anyway rolls and
retries once. Any other failure to post is a warning and exit 0: the journal is a run's
write-up, never its verdict. Manager reads the newest `steward-journal` issue, open or
closed (`js/github.js`, `state=all&per_page=1`), so it follows the roll with no change.
`test-journal.sh` holds all four paths in CI.

**What a run picked up** (2026-09-03): an improve entry now OPENS with a machine-readable
record — `<!-- steward-record: {…} -->` followed by a one-row table of ticket, branch, PR,
outcome, tool calls, turns, minutes and cost. `.github/steward/run-record.mjs` builds it by
reading the run's own event stream (the `ticket.mjs claim`, `git push`, `pr-create` and
`pr-merge` calls, with the PR number and merge sha from their results), so it is right even
when a run dies mid-sentence and it cannot claim a merge that did not happen. `outcome` is
one of `merged | open | resume | hold | blocked | died | no-pr` — `resume` is the run's own handoff (a `pr-resume` call in the stream) and `hold` is the owner's park switch, which a run no longer applies. The same table goes to the run's
Actions summary, the JSON to the `steward-record.json` artifact, and Manager reads the
marker to label each run in its Steward log. The heading now carries the slice
(`Steward improve — chicago [2/5]`), because five parallel runs used to post five entries
under one title. `--self-test` covers the parser against fixtures in
`.github/steward/fixtures/`.

**Watching a run while it happens** (2026-08-23, issue #139): every Claude-driven
steward workflow runs the agent with `--output-format stream-json` piped through
`.github/steward/stream-log.mjs`, which renders one line per action **as it
happens** — `[mm:ss] · Bash: node tools/check.sh`, `[mm:ss] ▸ <what it said>`.
Before this, `--output-format text` buffered the whole transcript until the process
exited, so a run's log stayed EMPTY for its entire life and a cancellation threw
away the evidence with the work: improve run #977 sat silent for 149 minutes, was
killed at the cap, and journalled "(no summary captured)". Alongside the live log:
- a **heartbeat** every five minutes in `steward-improve.yml` reporting elapsed time
  and how long the stream has been quiet, escalating to a `::warning::` past ten
  minutes of silence — so a genuinely wedged run is visible *while it is wedged*;
- the raw NDJSON event stream, uploaded as the `steward-stream-<run-id>` artifact
  (14 days) — the thing to download when a run needs explaining afterwards;
- `.github/steward/salvage.sh` (`if: always()`), which pushes any branch holding
  commits the remote never saw, and — only when the job did **not** succeed —
  parks a dirty tree on `steward/salvage/<run-id>`. A cancelled run no longer takes
  its work to the grave. Those salvage branches are unreviewed and ungated: read
  them, take what is useful, delete them. Nothing should ever be built on one.

The 150-minute cap was deliberately left alone. Whether it is too low was exactly
the question there was no evidence to answer; now there will be.

**How a run ships (the whole process):** steward works on a `steward/*` branch →
stamps changelog timestamps with the repo's own tool → runs the repo's smoke gate →
opens a PR → **merges it itself when green** → the merge triggers that app's
`deploy.yml` → Pages publishes. No human step; merge is ship. The only PRs that wait
for Kevin are ones the steward wasn't confident about (left open with an
explanation) — merge those on GitHub or tell any session "merge PR #N".

Why PRs (vs the old push-to-main loops): a shared library demands review points, and
the PR trail is the fleet's memory. Guard-main auto-revert remains the backstop
either way.

## Post-mortem: why not Claude Code Remote routines (2026-07-15)

The first steward implementation used CCR routines (scheduled triggers). Verdict
after a day of testing: **the trigger→execution path was unreliable in this
environment** — fresh-session routines spawned without repo access (the trigger API
we could drive can't embed git sources), a minimal push-one-file diagnostic produced
nothing in 20+ minutes, and a self-bound firing never arrived in its target session.
Interactive sessions and GitHub Actions executed the identical work flawlessly all
day. All steward routines were deleted; the two `zzARCHIVE` triggers are kept only
as historical reference and must stay disabled. Revisit routines in a few months —
the design ports back one-to-one if the infrastructure matures (the prompts in
`.github/steward/` are the portable source of truth).

## Rules for any agent touching the fleet

1. `vendor/polecat-shell/` is READ-ONLY in app repos. Shell changes go to
   polecat-platform and arrive by sync PR.
2. Every user-visible change ships a fleet-format changelog entry, and the shipping
   agent STAMPS timestamps itself with the repo's own tool (nothing stamps after
   merge) — games `tools/stamp-changelog.mjs`, jobtracker/relay/autoselector
   `.github/stamp-changelog.mjs`, analytics `tools/changelog-normalize.js`,
   chicago `chicago/4d/tools/stamp-changelog.mjs`, this
   repo's own `site/js/changelog.js` via `scripts/stamp-changelog.mjs`.
3. Smoke before merge: 390×780 + desktop, zero pageerrors. Mobile is a gate.
4. Never break `/js/changelog.js` parseability — Manager and the launcher read it live.
5. Branch `steward/*`, PR, merge only when green; never push to main directly.
6. One unit of high-quality work per run beats three rushed ones. Leave the PR open
   with an explanation when direction is ambiguous.
7. Sweeps run every app in parallel per-app subagents — give each its own working
   directory (a fresh `git worktree` or a `mktemp -d` clone), never a shared
   checkout. On 2026-07-28 sibling per-app agents sharing one checkout left visible
   scratch files reading each other's `*_ADMIN_TOKEN` vars; it read as a
   credential-harvesting plant until investigation (issue #101) showed every file
   matched its own app's designated sweep, never touching another app's token.
   Isolating working directories avoids the false-alarm overhead entirely.

## Cost posture

Hourly × 8 repos was paused for token cost. The steward improve loop is now driven
entirely by `.github/steward/focus.json` (2026-07-15): each app opts in with
`enabled` + an `everyHours` cadence, and `steward-focus.yml` dispatches only the
apps due that hour. As of 2026-09-23 every lane is paused (analytics.polecat.live
and the 4D lane — now `chicago` — were the continuous ones, `everyHours: 1`, pinned
to opus); flip a lane's `enabled` back to resume it. Scheduled spend is
therefore whatever the roster enables + the two daily sweeps; start/stop/retarget any
app by editing focus.json (no commit to a workflow; a push to that file ticks
steward-focus immediately, so it takes effect at once). Manual
`app=<repo>` dispatches and one-off fleet-pick runs remain free to start on demand.

Note that `offset` does nothing on an `everyHours: 1` lane — the evaluator reduces
it modulo the cadence, so `offset % 1` is always 0. Two hourly lanes therefore fire
on the same tick, which is fine: different repos dispatch in parallel under separate
concurrency groups, and only same-app overlap is skipped.

## The `chicago` lane (2026-09-23; the `custom` lane before it)

The 4D reconstruction of 1835 Chicago used to be one subtree of `kevinrhaas/custom`
(a monorepo of unrelated personal projects), and the `custom` lane was SCOPED to that
subtree (2026-08-10). On 2026-09-23 it moved into its own repositories:

- **`kevinrhaas/chicago`** — the code, data and research. The project still lives at
  `chicago/4d/` inside it (so no tool's paths changed); its generated, untracked Pages
  mirror is `site/4d/`, served at https://chicago.polecat.live/4d/.
- **`kevinrhaas/chicago-tickets`** — the ticket files (folders of 250 by number) and
  `QUEUE.md`. Every `ticket.mjs` change is a direct commit to its `main` — no PR — so
  ticket and queue edits never ride a code PR and never conflict with one. A claim is
  visible to every run the moment it is pushed; `done` sets `review`, and the tickets
  repo's settle workflow marks it `done` when the code PR actually merges.

The lane is now `chicago` in focus.json (same shape: hourly, 3 slices, 400 turns,
opus). The `custom` lane is left in the roster, disabled, with nothing in scope: a
run started on it reports that and stops. `.github/steward/improve.md` § CHICAGO 4D
carries the full rule — the gate (`chicago/4d/tools/check.sh` + the smoke by parts),
Blender on this runner, the tickets flow, owner decisions (`ticket.mjs ask`), and the
provenance invariant that outranks everything else there.


## Independent processor lanes

Manager → Fleet Ops → **Add lane** creates a paused named lane for an app.
Open its settings to choose **Claude Code** or **GPT / Codex**, a model ID,
and reasoning effort. Set concurrency and cadence, then enable and **Commit
roster**. The commit wakes the scheduler. **Run once** launches a separate,
non-recurring batch with the displayed settings, in addition to scheduled work.

The existing `apps` map remains unchanged and retains its historical slot and
concurrency identity. Optional `lanes` is a map of stable IDs to configurations:

```json
{
  "lanes": {
    "chicago-deep": {
      "app": "chicago", "name": "Deep work", "enabled": false,
      "processor": "claude", "model": "claude-opus-5-5", "effort": "max",
      "slices": 3, "everyHours": 1
    },
    "chicago-second": {
      "app": "chicago", "name": "Second processor", "enabled": false,
      "processor": "codex", "model": "gpt-6-astra", "effort": "xhigh",
      "slices": 2, "everyHours": 1
    }
  }
}
```

These are examples, not enabled production lanes. Add them to the existing
roster; do not replace `apps` or `jobs`. Each named lane has independent slots,
so these two settings target five simultaneous runs. Slices are local to a lane;
all runs still follow the target repository's atomic ticket-claim protocol.
Changes affect replacements; active runs finish unchanged. Lowering concurrency
waits for surplus runs to drain. Removing a lane does not cancel its active runs.
Do not reuse a removed lane's ID for a different app until its runs have drained.

`processor` defaults to `claude`. A blank model preserves the old Claude fleet
default; Codex defaults to GPT-6 Astra. Blank effort leaves the model default.
Known current choices expose low/medium/high/xhigh/max; Haiku uses default effort.
Custom IDs pass through unchanged, but access and supported effort remain the
provider's decision. Unsupported models fail visibly rather than switching to
another processor. The shared lane contract is mirrored in Manager `js/lanes.js`.

### Credentials and execution

Set **OPENAI_API_KEY** under polecat-platform → Settings → Secrets and variables
→ Actions before starting GPT lanes. It is passed as `CODEX_API_KEY` to
`codex exec`, never to Manager or the roster. This uses the API account's billing
and model access, not a browser ChatGPT subscription. Claude continues to use
**CLAUDE_CODE_OAUTH_TOKEN**. Both need the existing **STEWARD_PAT** for cross-repo
work. The runner checks only the selected provider's credential before installing
its CLI and browsers, and removes the other provider's credential from the child.

Both processors get the same prompt and disposable GitHub VM, git setup,
150-minute timeout, browser/geometry tools, salvage, and journal. Claude's
`max_turns` is still supported; Codex has no equivalent CLI bound, so that field
is not passed to it. Claude retains its existing transient-error continuation;
Codex failures end the run and salvage its work without a blind retry.
Codex JSONL is normalized for ticket/PR extraction and live logs while raw
artifacts retain original events. Cost is unreported when the CLI omits it.

The scheduler lists every page of active runs, matches exact app/lane titles,
and dispatches only free slots. Failed/invalid run-list responses abort the tick
instead of guessing that every slot is empty. GitHub concurrency groups retain
per-app/per-lane/per-slot serialization as a second guard.

Validation: `node .github/steward/test-lanes.mjs`,
`bash .github/steward/test-focus-jobs.sh`, and
`node .github/steward/run-record.mjs --self-test`.
