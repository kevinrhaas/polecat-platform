# Fleet Migration Plan — adopting Polecat Shell

Order chosen by risk/effort: prove the theming extremes first, then the template twins,
then the apps with special constraints. One app per phase; each phase ends green
(smoke + screenshots + changelog entry) before the next starts.

| # | App | Effort | Notes |
|---|---|---|---|
| 1 | **games** | S (pilot, this session) | No rail today → pure addition. Proves the `neon` palette (max theme distance from house style). Per-game pages untouched. |
| 2 | **relay** | S | Closest to the template already; drag-resize rail came FROM relay. Mostly import swaps + rightPanel adoption. |
| 3 | **jobtracker** | M | The richest app on the template. Swap ui/theme/icons/shell to vendored; keep views system app-local (views.js v2 extracts the rest later). Bump `jt-shell-v1` SW cache. |
| 4 | **manager** | M | Same template; ALSO gains the launcher-adjacent role: admin console over fleet + (later) user administration. CSS uses `--brand-a/b/c` → compat aliases cover it. |
| 5 | **autoselector** | M | 2-axis theming maps 1:1; keep `as.theme.v1` key via configure(). Keep its marketing site; adopt shell in `/app/`. |
| 6 | **polecat-app (chat)** | L | Adopt shell AND execute the chat.polecat.live rename per DOMAINS.md (export/handoff first, redirect stub after). Its marketing copy moves from the polecat repo. |
| 7 | **analytics** | L (LAST) | 22.6K LOC, own shell, routine-driven, strict STATUS.md conventions. Migrate only after shell v2 (views/right-panel proven everywhere else). Canonize its conventions; do not disturb the studio. |
| 8 | **polecat repo** | S | After chat rename: repurpose as chat marketing at a chat.polecat.live path or fold into polecat-app; polecat.live apex belongs to the platform by then. |

## Per-app definition of done

- Vendored shell imported with the app's historical storage keys (no state loss).
- App-local copies of ui/theme/icons/shell deleted (only after green).
- Waffle app-switcher present; What's-New in the right panel; tiles link to detail.
- SW cache name bumped; smoke green at 390×780 + desktop; screenshots regenerated;
  changelog entry shipped; app CLAUDE.md gains the vendor read-only rule.
