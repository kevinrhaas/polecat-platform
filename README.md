# polecat-platform

The platform hub for the **Polecat suite** — the family of joyful, static-first web apps
living under `*.polecat.live` (Manager, JobTracker, Analytics, AutoSelector, Relay,
Games, Chat).

This repo holds the three things every app shares:

1. **Polecat Shell** (`lib/`) — the shared UI library: design tokens, theming, the left
   rail + top bar + right panel, toasts/modals, icons, What's-New, saved views, tours,
   settings (simple/standard/expert), the fleet catalog, and the auth adapter seam.
   Plain ES modules. **No build step, no dependencies** — the fleet's house rule.
2. **The suite home** (`site/`) — polecat.live: the public marketing front door and the
   Google-style app launcher, with live per-app status ingested from each app's
   changelog.
3. **Standards** (`docs/`, `CLAUDE.md`) — the architecture, API contracts, DNS/domain
   runbook, automation playbook, and per-app migration plan.

## How apps consume the shell

Apps never import from this repo at runtime. Each app repo carries a
`vendor/polecat-shell/` folder — a verbatim, versioned copy of `lib/` (see
`lib/VERSION` + `lib/MANIFEST.json`). The `sync-shell.yml` workflow opens a
`chore: polecat-shell vX.Y.Z` PR against each app repo; the fleet steward reviews and
merges once that app's smoke test passes.

```js
import { toast } from './vendor/polecat-shell/ui.js';
import { initShell } from './vendor/polecat-shell/shell.js';
```

**`vendor/polecat-shell/` is read-only inside app repos.** App-specific looks live in
the app's own CSS (token overrides) and `registerIcons()` calls. `MANIFEST.json`
sha256 hashes let fleet sweeps detect illegal local edits.

## Repo map

```
lib/                Polecat Shell (see docs/SHELL-API.md)
lib/demo/           kitchen-sink demo page — the shell's own smoke-test target
site/               polecat.live marketing + launcher
docs/PLATFORM.md    architecture: repo topology, vendoring, auth seam, hosting
docs/SHELL-API.md   module-by-module API + the fleet changelog contract
docs/DOMAINS.md     DNS map, GoDaddy runbook, apex handoff, chat rename plan
docs/AUTOMATION.md  Actions vs routines playbook
docs/MIGRATION.md   per-app adoption order
scripts/            gen-manifest.mjs, smoke-test.mjs
ROADMAP.md          platform roadmap
CLAUDE.md           standards for agents working in this repo
```

## License

GPL-3.0 — the suite is open source and self-hostable end to end, including the
(bring-your-own) backend. See `docs/PLATFORM.md § Backend`.
