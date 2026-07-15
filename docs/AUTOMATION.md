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
| `steward-improve.yml` | `9 */2 * * *`, **gated by repo variables** (default OFF) | ONE unit of work on the app that most needs it — shell PRs first, then the MIGRATION.md queue, then stalest-release playbook work. **Focus mode:** dispatch with `app=<repo>` for a deep-dive on one app (this replaces per-app loops). **Scheduled runs:** set the `STEWARD_FOCUS_APP` repo variable to loop on one app, or `STEWARD_FLEET_MODE=on` for suite-wide; with neither set, scheduled runs skip in seconds. Turning improvement on/off per app is a variable flip, not a commit. |
| `steward-sweep-ux.yml` | daily 06:00 UTC | Read-only user walk of every live site → one prioritized findings issue per app. |
| `steward-sweep-tech.yml` | daily 09:00 UTC | Read-only audit: pageerrors, changelog contract, vendor sha256 drift, SW caches, CI health, hygiene, secrets → one issue per app. |
| `steward-shell-release.yml` | dispatch only | Bump lib/VERSION + manifest + tag, vendoring PRs to every app, merge the green ones. |

Secrets required on THIS repo: `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`)
and `STEWARD_PAT` (classic PAT, repo scope on kevinrhaas/* — powers cross-repo
clone/push and `gh` PRs/issues). Every workflow fails fast with a clear error if
either is missing.

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

Hourly × 8 repos was paused for token cost. The steward improve loop's cron is live
but gated by repo variables and defaults to OFF (scheduled runs skip in seconds when
neither `STEWARD_FOCUS_APP` nor `STEWARD_FLEET_MODE` is set — no token spend); Kevin
turns it on per app (or fleet-wide) with a variable flip, no commit. The daily sweeps
are the only always-scheduled spend. Focus bursts are free to start (dispatch) and
stop (they don't recur).
