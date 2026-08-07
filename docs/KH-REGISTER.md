# KH Register — Kevin-reported items (the fleet-wide series)

_doc: This register is DATA, like `.github/steward/focus.json` — appending or
updating a row is a **sanctioned direct commit to main** (sessions: pull →
edit → push; Manager: contents-API PUT with sha compare-and-swap). It is the
**single fleet-wide counter** for everything Kevin reports — live sessions,
issues, PR comments, any repo. Rules:

- **Next number = highest KH number in this file + 1.** Three digits,
  zero-padded (`KH-001`). Numbers are never reused; declined or superseded
  items keep theirs and move to Closed with a reason.
- **Categories (closed set):** `bug` · `ux` · `feature` · `perf` · `data` ·
  `security` · `docs` · `process`.
- **A KH row is the REPORT, not the work item.** The implementing backlog
  entry lives in the app's own scheme (an analytics STATUS.md NEXT item, a
  ROADMAP bullet, an AUD-## finding…) and cites its KH id — e.g. `(KH-012)`;
  the KH row links back via `implements:`. One report may spawn several
  scheme items; list them all.
- **Legacy series are GRANDFATHERED.** Analytics' LF1–70, LIVE-a–e, QA-01–10,
  VB, CONS, DURABLE and the ad-hoc singletons are never renumbered — they
  stay greppable under their own ids. If Kevin re-reports an open legacy
  item, it gets a KH number cross-linked to the legacy id (that is exactly
  how this register was seeded).
- Row shape:
  `- **KH-0NN** [category] Title — <repo> · reported <date> · implements: <ids> · <status notes>`

Seeded 2026-08-06 from every Kevin-reported item still OPEN in
analytics.polecat.live STATUS.md NEXT (verified against the live tree at
v833; shipped items were deliberately not back-numbered).

## Open

- **KH-001** [feature] Real per-user security: RLS enforced at the DB + the one-time Edge-Function relay for in-app go-live/provisioning (Option A, chosen 2026-07-24) — analytics · reported 2026-07-21 · implements: M7, M7 Slice 7 ★
- **KH-002** [feature] Ensemble views — "the median IS the product": blended common-estimate series as a first-class chart everywhere — analytics · reported 2026-07-16 · implements: V3 (partially delivered by CONS-1 v826's ensembleSeries)
- **KH-003** [ux] Scientific honesty: first-class no-data/coverage rendering + provenance popover on evidence charts — analytics · reported 2026-07-16 · implements: V9
- **KH-004** [feature] Schema browser for the remaining adapters (generic SQL/HTTP, DuckDB, SQLite) — dataset delight track — analytics · reported 2026-07-13 · implements: post-overhaul #5
- **KH-005** [feature] More data adapters (residual; one adapter question explicitly needs Kevin's call) — analytics · reported 2026-07-13 · implements: post-overhaul #2
- **KH-006** [data] PDC-RENAME-2: retire data-level "pdc" leftovers (sample connection id, PDC-BIDB-EXT jndi, /public/pdc-iteration/v2 path) with a real data-migration story — analytics · reported 2026-07-30 · implements: PDC-RENAME-2
- **KH-007** [data] Supabase sync follow-up: per-table diff pushes instead of whole-snapshot rewrites — analytics · reported 2026-07-30 · implements: LIVE-c (largely overtaken by DURABLE-2 v799's upsert-first + tombstone save; verify what remains before working it)
- **KH-008** [ux] Studio Data-panel/library reorganization: packs contribute real objects, one library model (reconcile with LF43/LF57/LF59), compact cards, fix drag-to-canvas across the iframe boundary — analytics · reported 2026-07-27 · implements: LF66 (sub-items 1, 2, 4, 5, 6 open)
- **KH-009** [bug] "Export as PNG" silently missing for panels that render to canvas (GL/MapLibre choropleth) — needs preserveDrawingBuffer-aware capture — analytics · reported 2026-07-27 · implements: LF69 (c)
- **KH-010** [ux] Sample-pack-aware welcome: curated pack segments folded into the hero/overview carousel itself (tour steps computed at open time) — analytics · reported 2026-07-27 · implements: LF40 residual
- **KH-011** [ux] Builder toolbar: visible "Save as…" next to Save + a richer Open dialog (preview tiles) — analytics · reported 2026-07-27 · implements: LF45
- **KH-012** [ux] Extend Focus/Slideshow modes to the read-only Viewer route for non-developer roles — analytics · reported 2026-07-27 · implements: LF48 residual
- **KH-013** [ux] One truly-shared nav component (finish the LF51 CORE PRINCIPLE): Explore navigator folder tree + Repository as the robust cross-object command center — analytics · reported 2026-07-27 · implements: LF51 residual
- **KH-014** [ux] Tighten app density: kill the unused left-gutter whitespace, left-align content — analytics · reported 2026-07-27 · implements: LF54
- **KH-015** [ux] Views catalog row actions: Duplicate + Export/"make standalone" — analytics · reported 2026-07-27 · implements: LF57 residual
- **KH-016** [ux] Remove the Studio Examples menu/button and drop the "Examples" naming (touches ~20 tests + Home quick action — dedicated slice) — analytics · reported 2026-07-27 · implements: LF43 slice 2
- **KH-017** [feature] Per-user provisioning extras: Simple-mode default on the user record + impersonate-to-set — analytics · reported 2026-07-27 · implements: LF41 residual
- **KH-018** [feature] Quick-import complexity chosen on the way in (simple/medium/complex drop zones — each level QUALITATIVELY different) — analytics · reported 2026-07-27 · implements: LF50 (c)
- **KH-019** [docs] Tour introduces and defines every domain term (adapters, connections, datasets, jobs, workbooks, dashboards, Views, filters) — analytics · reported pre-2026-07 · implements: #23
- **KH-020** [process] Recurring docs/tour/marketing currency: keep welcome, Help, marketing and screenshots current with the app (periodic refresh, never big-bang) — analytics · reported 2026-07-27 · implements: LF58 / DOCS-CURRENCY track
- **KH-021** [feature] View Builder chart-type parity with Studio, majors first (open-ended catalog backlog beyond the shipped choropleth/stacked/scatter/KPI) — analytics · reported 2026-07-30 · implements: VB-4 (open-ended)
- **KH-022** [feature] Private/public visibility toggle beyond dashboards: datasets, Views, connections, jobs — analytics · reported 2026-07-21 · implements: M4.2 residual
- **KH-023** [bug] List rows crushed long names to a letter-per-line sliver on a phone (Admin users) — analytics · reported 2026-08-07 · SHIPPED v867 (fixed on the shared `.cx-row`, the third sighting of this bug class)

## Closed

- (none yet — rows move here with `· shipped vNNN / PR #NNN` or `· declined: <reason>`)
