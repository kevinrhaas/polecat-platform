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
| `steward-focus.yml` | heartbeat tick every 10 min (`*/10`, Claude-free) | **The multi-app focus roster.** Reads `.github/steward/focus.json` through `.github/steward/schedule.mjs` (the canonical evaluator) and, each tick, **tops up** every enabled lane that is due. Lane schedule fields: `enabled`, `everyHours`, `offset` (align which hours the cadence lands on), `window` (UTC hour window, wraps midnight), `startAt` (sleep until), `until` (expire at — "run every X until Y"), `slices` (1..10, default 1). **`slices` is a standing CONCURRENCY TARGET, not a batch size** (changed 2026-09): the lane keeps N improve runs going at all times, each a full unit of work with its own PR + smoke gate. Each tick counts how many of the N slots are occupied and dispatches only the empty ones, so one run finishing frees one slot and one replacement starts while its siblings carry on. The refill reuses that slot's OWN number (`slice=k`), which matters twice: the slice index is part of `steward-improve`'s concurrency group (`…-s<k>`), and slice k takes the **k-th** topmost workable item — stable because a claimed item keeps its place in the list (see `.github/steward/improve.md` § PARALLEL SLICES; chicago/4d additionally locks per-ticket via `tools/ticket.mjs claim`/`inflight`). This replaced a BATCH GATE that fired all N and then skipped the lane until every one had finished — so a lane moved at the pace of its slowest run, and one set to 10 spent much of its time running one. Before that it chained one-at-a-time, only because all slices shared a concurrency group that holds one running + one pending and cancelled the surplus. For continuous operation keep `everyHours: 1`, which makes the lane eligible on every tick. **The loop does not depend on the cron:** every successful run dispatches `steward-focus` itself (its final step), so a freed slot refills within about a minute. That matters because GitHub throttles schedule events hard under load — measured 2026-08-27, ticks arrived 99–214 minutes apart and then stopped for ~6 hours. The cron is a backstop, and the recovery path for a slot freed by a run that FAILED (the kick is gated on success). A lowered `slices` is honoured by letting the surplus drain, never by cancelling it. Different apps run in parallel, and so do a lane's own slices. Edit lanes from Manager's Fleet Ops panel, the GitHub UI, or any session — effective next tick, no workflow edits. Preview with `node .github/steward/schedule.mjs next`. |
| `steward-sweep-ux.yml` | roster job `sweep-ux` (default daily, 06 UTC) | Read-only user walk of every live site → one prioritized findings issue per app. |
| `steward-sweep-tech.yml` | roster job `sweep-tech` (default daily, 09 UTC) | Read-only audit: pageerrors, changelog contract, vendor sha256 drift, SW caches, CI health, hygiene, secrets → one issue per app. |
| `steward-janitor.yml` | roster job `janitor` (default every 2h; Claude-free) | **The no-manual-merges guarantee.** Sweeps all fleet repos for open `steward/*` / `chore/polecat-shell-*` PRs, re-runs each app's own smoke gate against the branch, merges the green ones, comments once on the red ones. Never touches drafts or PRs labeled `hold` — that label is Kevin's park-for-review switch. |
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

**What a run picked up** (2026-09-03): an improve entry now OPENS with a machine-readable
record — `<!-- steward-record: {…} -->` followed by a one-row table of ticket, branch, PR,
outcome, tool calls, turns, minutes and cost. `.github/steward/run-record.mjs` builds it by
reading the run's own event stream (the `ticket.mjs claim`, `git push`, `pr-create` and
`pr-merge` calls, with the PR number and merge sha from their results), so it is right even
when a run dies mid-sentence and it cannot claim a merge that did not happen. `outcome` is
one of `merged | open | hold | blocked | died | no-pr`. The same table goes to the run's
Actions summary, the JSON to the `steward-record.json` artifact, and Manager reads the
marker to label each run in its Steward log. The heading now carries the slice
(`Steward improve — custom [2/5]`), because five parallel runs used to post five entries
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
   custom `chicago/4d/tools/stamp-changelog.mjs`, this
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
apps due that hour. Currently enabled: **analytics.polecat.live** and **custom**,
both continuous (`everyHours: 1`, pinned to opus). Everything else is paused —
autoselector.polecat.live ran a ~6-hour burst on 2026-07-15 and
jobtracker.polecat.live was paused the same day at Kevin's request; flip either
app's `enabled` back to resume. Scheduled spend is
therefore whatever the roster enables + the two daily sweeps; start/stop/retarget any
app by editing focus.json (no commit to a workflow, effective next tick). Manual
`app=<repo>` dispatches and one-off fleet-pick runs remain free to start on demand.

Note that `offset` does nothing on an `everyHours: 1` lane — the evaluator reduces
it modulo the cadence, so `offset % 1` is always 0. Two hourly lanes therefore fire
on the same tick, which is fine: different repos dispatch in parallel under separate
concurrency groups, and only same-app overlap is skipped.

## The `custom` lane is SCOPED (2026-08-10)

`kevinrhaas/custom` is not an app — it is Kevin's monorepo of unrelated personal
projects (CAD, 3D-print models, the Joliet game, a small landing site). Its steward
lane exists for exactly one subtree: **`chicago/4d/`**, a walkable,
historically-sourced 3D reconstruction of 1835 Chicago, plus its published mirror
`site/chicago/4d/`. `.github/steward/improve.md` carries the full rule — the gate
(`chicago/4d/tools/check.sh` + `tools/smoke_renderer.mjs`, after
`pip install jsonschema pyproj`), the no-Blender-on-this-runner constraint (bakes
belong to the repo's own nightly `chicago-4d-bake.yml`), the
publish-in-the-same-commit requirement, and the provenance invariant that outranks
everything else there. A run that edits anything else in that repo is out of scope.
