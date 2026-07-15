# Automation Playbook — Actions × Routines (hybrid)

## Division of labor

**GitHub Actions keep the deterministic spine** (boring, proven, in-repo):
- `deploy.yml` — Pages deploy on push to main (+ workflow_run after bot pushes).
- Smoke tests — Playwright at 390×780 + desktop, zero pageerrors. ADVISORY only:
  **never hard-gate deploy on CI** (a `needs: test` gate once froze analytics ~21h).
  Self-healing beats gating: `auto-revert.yml` ("Guard main") reverts a broken main.
- `archive-release.mjs` — frozen `/v/<n>/` snapshots + `releases.json` (jobtracker/
  autoselector pattern; adopt fleet-wide as apps migrate).
- `sync-shell.yml` (platform repo) — opens vendoring PRs to app repos.
- `self-improve.yml` in app repos — kept as **dispatch-only fallback** (schedules stay
  commented out). @claude mention workflows stay.

**Claude Code Remote routines drive the agentic work** (centrally controlled, easy to
pause/retarget, coordinated):

> **LIVE since 2026-07-15** — four routines exist (fresh session per run, PR-based,
> merge-only-when-smoke-green):
> `Polecat fleet-improve (every 2h)` · `Polecat fleet-sweep-ux (Mon 9am CT)` ·
> `Polecat fleet-sweep-tech (Thu 9am CT)` · `Polecat shell-release (on demand)`.
> Manage them from any Claude Code session (list/pause/fire/delete triggers) or ask
> the steward.
>
> **Per-app focus loops (created DISABLED — enable to deep-dive):** each app also has
> an hourly "<App> hourly improve (enable to focus)" routine carrying its own playbook
> (ROADMAP/BUILD_LOOP/STATUS) plus the fleet ship rules. Turn one on to pour hourly
> work into a single app ("enable the games loop"), fire it once for a single burst,
> and disable it when the deep-dive ends. They stack safely with fleet-improve because
> everything ships via PR.
>
> **How a run ships (the whole process):** routine does the work on a `steward/*`
> branch → stamps changelog timestamps with the repo's own tool → runs the repo's
> smoke gate → opens a PR → **merges it itself when green** → the merge triggers
> `deploy.yml` → GitHub Pages publishes. No human step, no separate publish command:
> merge IS ship. The only PRs that wait for Kevin are ones a routine wasn't confident
> about (left open with an explanation) — approve those by merging on GitHub or by
> telling any session "merge PR #N", and the deploy still fires automatically. The old per-app routine "Dashboard Studio — hourly self-improvement"
> (pushed straight to analytics main) is superseded and should stay disabled; delete
> it once analytics migrates. Cadence changes are one `update_trigger` call.
- **One steward session** owns the fleet. Its routines:
  - `fleet-improve` (e.g. hourly or every 2h, budget-aware): pick ONE app by need
    (manager health data tells it which), do one playbook unit of work on a branch,
    open a PR. The per-app playbooks (BUILD_LOOP.md / ROADMAP.md / STATUS.md) remain
    the source of what to build.
  - `fleet-sweep-ux` (weekly): walk every live site as a user (mobile + desktop
    screenshots, dead links, tiles-link-to-detail rule, theme audit) → issues/PRs.
  - `fleet-sweep-tech` (weekly): headless technical pass (console errors, SW cache
    versions, MANIFEST sha256 drift in vendor/, changelog contract parse, Lighthouse
    basics) → issues/PRs.
  - `shell-release` (on demand): bump lib/VERSION, gen-manifest, tag, dispatch
    sync-shell, then review/merge each app PR after its smoke passes.
- Why PRs now: main-committing hourly loops were fine per-app, but a shared library
  demands review points. The steward is the "master merge agent" — with a visible
  PR trail instead of invisible merges.

## Rules for any agent touching the fleet

1. `vendor/polecat-shell/` is READ-ONLY in app repos. Shell changes go to
   polecat-platform and arrive by sync PR.
2. Every user-visible change ships a fleet-format changelog entry (empty `ts`,
   CI stamps it).
3. Smoke before push: 390×780 + desktop, zero pageerrors. Mobile is a gate.
4. Never break `/js/changelog.js` parseability — Manager and the launcher read it live.
5. One unit of high-quality work per run beats three rushed ones. Ask the human
   (AskUserQuestion) when direction is ambiguous.

## Cost posture

Hourly × 8 repos was paused for token cost. The steward model spends tokens where the
fleet needs them (health-weighted) instead of uniformly, and the human sets cadence by
enabling/disabling routines in one place.
