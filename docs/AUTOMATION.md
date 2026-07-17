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
| `steward-focus.yml` | hourly tick (Claude-free) | **The multi-app focus roster.** Reads `.github/steward/focus.json` and dispatches one focus improve run per enabled app whose `everyHours` cadence matches the hour. Different apps run in parallel (per-app concurrency groups, separate repos); the same app never overlaps itself. Enable/disable apps and set cadence by editing focus.json — GitHub UI, any session, or (roadmap) the Manager console; effective next tick, no workflow edits. |
| `steward-sweep-ux.yml` | daily 06:00 UTC | Read-only user walk of every live site → one prioritized findings issue per app. |
| `steward-sweep-tech.yml` | daily 09:00 UTC | Read-only audit: pageerrors, changelog contract, vendor sha256 drift, SW caches, CI health, hygiene, secrets → one issue per app. |
| `steward-janitor.yml` | every 2h (Claude-free) | **The no-manual-merges guarantee.** Sweeps all fleet repos for open `steward/*` / `chore/polecat-shell-*` PRs, re-runs each app's own smoke gate against the branch, merges the green ones, comments once on the red ones. Never touches drafts or PRs labeled `hold` — that label is Kevin's park-for-review switch. |
| `steward-shell-release.yml` | dispatch only | Bump lib/VERSION + manifest + tag, vendoring PRs to every app, merge the green ones. |

Secrets required on THIS repo: `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`)
and `STEWARD_PAT` (classic PAT, repo scope on kevinrhaas/* — powers cross-repo
clone/push and `gh` PRs/issues). Every workflow fails fast with a clear error if
either is missing.

Optional secret: `MANAGER_ADMIN_TOKEN` — the admin token for the manager app's
client-side invite gate (lib/access.js). When set, the UX sweep and
manager-focused improve runs unlock manager.polecat.live/app/ and exercise the
real UI; when absent, they audit the gate screen + repo source and say so.
The prompts forbid ever echoing its value into issues, PRs, commits, or logs.
Note the gate is UX gating, not security (the app is a public static site), so
this token is low-sensitivity — but treat it as a secret anyway.

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
   `.github/stamp-changelog.mjs`, analytics `tools/changelog-normalize.js`.
3. Smoke before merge: 390×780 + desktop, zero pageerrors. Mobile is a gate.
4. Never break `/js/changelog.js` parseability — Manager and the launcher read it live.
5. Branch `steward/*`, PR, merge only when green; never push to main directly.
6. One unit of high-quality work per run beats three rushed ones. Leave the PR open
   with an explanation when direction is ambiguous.

## Cost posture

Hourly × 8 repos was paused for token cost. The steward improve loop is now driven
entirely by `.github/steward/focus.json` (2026-07-15): each app opts in with
`enabled` + an `everyHours` cadence, and `steward-focus.yml` dispatches only the
apps due that hour. Currently enabled: (none) — autoselector.polecat.live ran a
~6-hour burst on 2026-07-15 (now paused at the end of the window) and
jobtracker.polecat.live was paused the same day at Kevin's request; flip either
app's `enabled` back to resume. Scheduled spend is
therefore whatever the roster enables + the two daily sweeps; start/stop/retarget any
app by editing focus.json (no commit to a workflow, effective next tick). Manual
`app=<repo>` dispatches and one-off fleet-pick runs remain free to start on demand.
