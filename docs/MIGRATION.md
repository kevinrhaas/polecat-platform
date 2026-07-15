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
| 5 | **polecat-app (chat)** | L | **ASSIGNED to a dedicated session (2026-07-15, session_01WSWYSr2Pe2SJerMcwNAJ1p) — scheduled steward runs SKIP this app** (leave its open steward/* PRs alone too). Adopt shell; the chat.polecat.live rename stays GATED on Kevin's written go per DOMAINS.md (export/handoff first, redirect stub after). Its marketing copy moves from the polecat repo. |
| 6 | **analytics** | L | 22.6K LOC, own shell, routine-driven, strict STATUS.md conventions. Migrate only after shell v2 (views/right-panel proven everywhere else). Canonize its conventions; do not disturb the studio. |
| 7 | **relay** | S (LAST — per Kevin) | Technically the easiest (closest to the template; the drag-resize rail came FROM relay), but deliberately scheduled last at Kevin's direction. Mostly import swaps + rightPanel adoption when its turn comes. |
| 8 | **polecat repo** | S | **ASSIGNED to the same dedicated session as polecat-app — scheduled steward runs SKIP this repo.** After chat rename: repurpose as chat marketing at a chat.polecat.live path or fold into polecat-app; polecat.live apex already belongs to the platform. |

## Per-app definition of done

- Vendored shell imported with the app's historical storage keys (no state loss).
- App-local copies of ui/theme/icons/shell deleted (only after green).
- Waffle app-switcher present; What's-New in the right panel; tiles link to detail.
- SW cache name bumped; smoke green at 390×780 + desktop; screenshots regenerated;
  changelog entry shipped; app CLAUDE.md gains the vendor read-only rule.
