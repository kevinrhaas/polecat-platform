# Domains, DNS & Hosting Runbook

## Target map

| Domain | Repo | Role |
|---|---|---|
| polecat.live | polecat-platform (`site/`) | Suite marketing + launcher (public front door) |
| chat.polecat.live | polecat-app | The consensus-chat app (LIVE — renamed 2026-07-18) |
| app.polecat.live | polecat (repo) | Data-carrying "we moved" handoff stub → chat.polecat.live (keep for months; installed PWAs pin here) |
| manager.polecat.live | manager.polecat.live | Fleet console (admin-leaning) |
| jobtracker.polecat.live | jobtracker.polecat.live | JobTracker |
| analytics.polecat.live | analytics.polecat.live | Dashboard Studio |
| autoselector.polecat.live | autoselector.polecat.live | AutoSelector |
| relay.polecat.live | relay.polecat.live | Relay (P2P tables + chat) |
| games.polecat.live | games.polecat.live | Arcade |
| modelserver.polecat.live | solution-engineering (`model-server/`) | Self-hosted model server — OCI VM + Caddy, NOT Pages (A record → VM IP; cert via Caddy/SERVER_DOMAIN) |

Subdomain naming stays `<app>.polecat.live` — memorable, standard (Google-style
product.domain), and each maps 1:1 to a repo + Pages site (modelserver is the
one non-Pages exception above).

## GoDaddy DNS (current pattern, keep)

- Each subdomain: `CNAME <app> → kevinrhaas.github.io`.
- Apex `polecat.live`: A records → GitHub Pages IPs (185.199.108.153/109/110/111)
  + `www` CNAME → kevinrhaas.github.io.
- The repo's `CNAME` file + Pages "custom domain" setting tell GitHub which repo
  serves which host. DNS itself never changes when a domain moves between repos.

## Apex handoff: polecat.live → polecat-platform (do in ONE sitting)

1. Merge the platform repo's `site/` and enable Pages (deploy.yml, source: Actions).
2. In the **polecat** repo Pages settings: REMOVE custom domain `polecat.live`
   (and delete its `CNAME` file in the same commit).
3. In **polecat-platform** Pages settings: ADD custom domain `polecat.live`
   (site/CNAME already contains it). Verify HTTPS cert issues.
4. Old marketing content stays in the polecat repo (future chat.polecat.live
   marketing page; its copy is chat-specific already).

Gap between 2 and 3 = polecat.live serving 404s; keep it to minutes.

## app.polecat.live → chat.polecat.live (DONE 2026-07-18 — sequence kept for reference)

Executed on Kevin's written go: handoff shipped + verified (polecat-app#4),
DNS added by Kevin, Pages repointed (polecat-app#14), the polecat repo claims
app.polecat.live with the data-carrying stub (polecat#3). Original gated
sequence below.

PWA installs are pinned to their origin and localStorage does NOT cross origins
(chat history + BYOK API keys live there). Sequence:

1. Ship export/import + an origin-handoff path in polecat-app (e.g. redirect with a
   one-time `#handoff=<payload>` the new origin imports), BEFORE any DNS work.
2. Add `chat` CNAME in GoDaddy → kevinrhaas.github.io.
3. Point the polecat-app repo's Pages custom domain at chat.polecat.live.
4. Publish a static stub on app.polecat.live (separate tiny repo or branch) with
   meta-refresh + JS redirect + "we moved" copy + re-install-PWA banner. Keep it for
   months.
5. Update every polecat.live CTA and the fleet catalog entry.

## Private / protected apps

- GitHub Pages from a private repo requires a paid plan.
- The practical free option: **Cloudflare Access** in front of the Pages origin
  (move DNS for that subdomain behind Cloudflare, add an Access policy —
  email/Google/GitHub SSO). Analytics' PUBLISH.md already documents this pattern.
- The in-app ECDSA gate (`access.js`) hides UI but the static files remain public —
  UX gating only, never a security boundary.
