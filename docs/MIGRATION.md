# Fleet Migration Plan — adopting Polecat Shell

Order chosen by risk/effort: prove the theming extremes first, then the template twins,
then the apps with special constraints. One app per phase; each phase ends green
(smoke + screenshots + changelog entry) before the next starts.

| # | App | Effort | Notes |
|---|---|---|---|
| 1 | **games** | S (DONE — pilot) | No rail today → pure addition. Proved the `neon` palette (max theme distance from house style). Per-game pages untouched. |
| 2 | **jobtracker** | M | The richest app on the template. Swap ui/theme/icons/shell to vendored; keep views system app-local (views.js v2 extracts the rest later). Bump `jt-shell-v1` SW cache. |
| 3 | **manager** | M | Same template; ALSO gains the launcher-adjacent role: admin console over fleet + (later) user administration. CSS uses `--brand-a/b/c` → compat aliases cover it. |
| 4 | **autoselector** | M | 2-axis theming maps 1:1; keep `as.theme.v1` key via configure(). Keep its marketing site; adopt shell in `/app/`. |
| 5 | **polecat-app (chat)** | L (shell DONE 2026-07-15) | **ASSIGNED to a dedicated session (2026-07-15, session_01WSWYSr2Pe2SJerMcwNAJ1p) — scheduled steward runs SKIP this app** (leave its open steward/* PRs alone too). Shell adopted (polecat-app#2, shipped): frame/waffle/What's-New on the historical `polecat_theme`/`polecat`/`polecat_history` keys, legacy theme values migrated pre-paint, smoke gate added at `scripts/smoke-test.mjs`. The chat.polecat.live rename per DOMAINS.md remains GATED on Kevin's written go (export/handoff first, redirect stub after) — NOT done. |
| 6 | **analytics** | L | Dedicated session completed the process migration (PR flow, stamping, chrome-level shell, waffle, What's-New — 2026-07-15/16) and continues the Viridis geo-analytics track. **Hourly focus runs ENABLED per Kevin 2026-07-16 (focus.json)** — scheduled runs no longer skip this app: work STATUS.md NEXT top-down, leave `steward/viridis-*` branches/PRs to the dedicated session, and coordinate through open steward/* PRs. Strict STATUS.md conventions; the Studio three-pane workspace still waits for shell v2 (unless a session upgrades the shell itself via platform PRs); do not disturb the studio's spec/export invariants. |
| 7 | **relay** | S (LAST — per Kevin) | Technically the easiest (closest to the template; the drag-resize rail came FROM relay), but deliberately scheduled last at Kevin's direction. Mostly import swaps + rightPanel adoption when its turn comes. |
| 8 | **polecat repo** | S (PRs on hold) | **ASSIGNED to the same dedicated session as polecat-app — scheduled steward runs SKIP this repo.** Fold built and parked for Kevin 2026-07-15: chat marketing moves into polecat-app at `/welcome/` (polecat-app#3, `hold`), then the polecat repo becomes a redirect stub (polecat#1, `hold`) and an archive candidate. Merge order: polecat-app#3 FIRST. Independent of the still-gated chat rename — /welcome/ is same-origin with the app and survives it. |

## Per-app definition of done

- Vendored shell imported with the app's historical storage keys (no state loss).
- App-local copies of ui/theme/icons/shell deleted (only after green).
- Waffle app-switcher present; What's-New in the right panel; tiles link to detail.
- SW cache name bumped; smoke green at 390×780 + desktop; screenshots regenerated;
  changelog entry shipped; app CLAUDE.md gains the vendor read-only rule.
