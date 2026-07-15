# Polecat Platform — Roadmap

## Now (shell v0.1, this iteration)
- [x] Blueprint docs (PLATFORM / SHELL-API / DOMAINS / AUTOMATION / MIGRATION)
- [x] Polecat Shell v0.1.0 (`lib/`) + kitchen-sink demo
- [x] polecat.live launcher site (logged-out, live fleet status)
- [x] Pilot: games.polecat.live home on the shell (`neon` palette)

## Next
- [x] Create GitHub repo + first PR; Pages on; apex handoff (DOMAINS.md § handoff)
      — polecat.live serves the launcher as of 2026-07-15 (domain reassigned
      automatically on deploy; same-account transfer)
- [ ] Steward routines: fleet-improve, fleet-sweep-ux, fleet-sweep-tech, shell-release
      (AUTOMATION.md) — cadence + budget confirmed with Kevin before enabling
- [ ] Migrate jobtracker → manager → autoselector (MIGRATION.md; relay deliberately last)
- [ ] Supabase project: Google/Apple/email providers; launcher sign-in live;
      account menu in the shell topbar
- [ ] Fleet catalog: per-app og images + consistent single-color app glyphs

## Later
- [ ] Shell v2 views: in-grid editing, column drag/resize, bulk bar, CSV/XLS export
      (extract from jobtracker once storage contracts are stable)
- [ ] User administration in Manager (roles, feature grants, app on/off) on the auth seam
- [ ] Cross-suite reporting: fleet data mirrored to the main backend, dashboards built
      on the analytics engine
- [ ] chat.polecat.live rename (gated sequence in DOMAINS.md)
- [ ] Analytics adopts the shell (last, after v2)
- [ ] Native packaging (Capacitor) starting with the launcher; app-store readiness pass
- [ ] Notifications: unify the bell across apps; optional push via the backend
