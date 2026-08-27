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
| `steward-focus.yml` | heartbeat tick every 10 min (`*/10`, Claude-free) | **The multi-app focus roster.** Reads `.github/steward/focus.json` through `.github/steward/schedule.mjs` (the canonical evaluator) and, each tick, dispatches a focus improve BATCH per enabled lane that is due AND idle — so a lane fires its next batch within ~10 min of the last finishing, and a batch that died mid-way restarts on the next tick rather than stalling an hour. Drop the cron to `*/5` to run harder. Lane schedule fields: `enabled`, `everyHours`, `offset` (align which hours the cadence lands on), `window` (UTC hour window, wraps midnight), `startAt` (sleep until), `until` (expire at — "run every X until Y"), `slices` (1..10, default 1 — how many improve runs the lane fires IN PARALLEL each time it is due; each is a full unit of work with its own PR + smoke gate). Slices are **fired all at once, not chained** (changed 2026-08): steward-focus dispatches slice=1..N in the same tick and they work simultaneously — N agent lanes on one app. Each run is told `SLICE: k of N` and takes the **k-th** topmost workable item from that app's queue, so siblings starting from an identical repo state don't all build the same thing (see `.github/steward/improve.md` § PARALLEL SLICES; chicago/4d additionally locks per-ticket via `tools/ticket.mjs claim`/`inflight`). This used to chain one-at-a-time only because all slices shared one concurrency group, which holds one running + one pending and cancelled the surplus; `steward-improve`'s group now carries the slice number (`…-s<k>`), which is what makes the fan-out safe. Batch semantics: the skip-if-busy check means a new batch fires only when the lane is due again AND **no** slice of the previous batch is still in flight — a lane tops up as a whole, never mid-batch. Different apps run in parallel, and so do a lane's own slices. Edit lanes from Manager's Fleet Ops panel, the GitHub UI, or any session — effective next tick, no workflow edits. Preview with `node .github/steward/schedule.mjs next`. |
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
