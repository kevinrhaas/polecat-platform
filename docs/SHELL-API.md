# Polecat Shell — API Reference (v0.4.2)

Plain ES modules, no dependencies, no build. Import from `vendor/polecat-shell/`.
Every module that persists anything takes a `storageKey` — apps keep their historical
keys (`as.theme.v1`, `jt.rail.open`, …) so adoption never wipes user state.

## tokens.css

The design-token vocabulary, in `:root` with `[data-theme="light"|"dark"]` and
`[data-palette="<name>"]` blocks. Canonical names:

```
--bg --bg-2 --surface --surface-2 --surface-3 --border --line
--text --text-2 --text-3 --ink --ink-dim
--brand --brand-2 --accent --accent-2
--success --danger --warning --info
--rail-bg --rail-bg2 --rail-line --rail-accent --rail-w --rail-w-open
--radius --radius-sm --radius-lg --shadow --shadow-sm --ring
--font --mono --font-display
```

Compat aliases (`--brand-a: var(--brand)` etc.) keep Manager-era CSS working during
migration. Palettes shipped in v1: `polecat` (warm amber house style), `aurora`
(violet/teal), `neon` (Miami-Vice magenta/cyan, built for Games). Apps may define their
own palette block in app CSS — the shell only reads tokens.

## theme.js

Two axes stamped on `<html>`: `data-palette` × `data-theme` (+ `data-reduce-motion`).

```js
configure({ storageKey, palettes?, defaultTheme? })   // call before applyTheme
PALETTES, MODES                                       // registered lists
getTheme() -> { palette, mode }                       // stored values
setTheme(palette, mode); toggleMode()                 // persist + stamp
applyTheme()                                          // stamp from storage (boot)
effectiveMode() -> 'dark'|'light'                     // resolves 'system'
PREPAINT_SNIPPET                                      // inline <head> script text —
                                                      // stamps attrs before first paint
```

## ui.js

DOM toolkit + feedback primitives (from the fleet's shared `ui.js`):
`$ $$ el(tag,props,children) field escapeHtml uuid` ·
`toast(title,{body,kind,ms,action})` — `action:{label,fn}` (v0.3.0) renders an
inline action button (the "Undo" toast pattern) ·
`modal({title,icon,body,foot,wide,onClose}) -> {root,back,body,hide}` — full
dialog a11y (focus trap, stacked-Escape, focus restore); `body`/`foot` accept
DOM nodes, arrays, or (v0.3.0) HTML strings ·
`sheet({title,body,side})` (same body/foot contract) ·
`anchoredPopover(anchor,panel,{position,onClose})` ·
`confirmDialog({title,message,okText,danger})` · `promptDialog({...})` ·
`celebrate(n)` (reduced-motion aware) · `avatarColor initials` ·
`fmtDate fmtDateTime relTime isoDate` · `copy download debounce`.

## icons.js

Single-color inline-SVG registry (24×24 viewBox, `stroke: currentColor`).
`icon(name, size=20) -> svg string` · `registerIcons(map)` for app families ·
`iconNames()`. Never ship multi-color or filled icon sets — theming comes free from
currentColor. The base set includes the chrome/media controls `back`,
`fullscreen`, `sound`, `muted` (v0.4.0 — promoted from Games' game-chrome, so
apps no longer need to `registerIcons()` them locally).

## shell.js

The app frame: left rail + top bar + main view + right panel + app switcher.

```js
initShell({
  app: { id, name, wordmark? },
  sections: [ { key, label, icon, minMode?, admin? } | { group } ],
  onNav(key), isAdmin?(), uiMode?(),
  rail: { storageKey, resizable? },
  topbar: { left?[], center?[], right?[] },   // slot arrays of nodes/builders
}) -> { setActive, setBadge(key, n, tone?), setOpen, els }
// setBadge tone (v0.2.0, optional): themes the count badge — 'danger' ships
// in shell.css (Manager's needs-attention red); apps may style their own
// `tone-<name>` classes. Rail brand + collapse toggle also gained
// :focus-visible rings in v0.2.0 (previously app-skinned).

rightPanel({ title, body, onClose }) -> { close }   // slide-in panel (What's-New,
                                                    // notifications, change log)
appSwitcher(catalog, { current }) -> node           // waffle menu for the topbar
```

Rail behavior: collapse to icons, drag-to-resize, mobile drawer + backdrop, state
persisted under the app's keys. Sections filter by `minMode`/`admin`. The drawer
never pops open over content: it boots closed on mobile, AND an open desktop rail
auto-closes (without persisting) when the viewport crosses into drawer range
mid-session — window shrink or phone rotation (v0.2.1).

## whatsnew.js

`initWhatsNew({ entries, latest, storageKey, mount?, labels? })` — renders the
What's-New feed (in a `rightPanel` by default), tracks the unseen dot by comparing
`latest` to the stored seen-version. `hasUnseen(storageKey, latest)`.

## store.js

`createStore({ storageKey, schemaVersion, migrations, seed, maxUndo=100 })` →
`{ get, mutate(label, fn), undo, redo, canUndo, canRedo, on, off, export, import }`.
Additive migrations (`migrations[n]` upgrades n→n+1, never deletes unknown keys),
snapshot-based undo/redo, Emitter events (`change`, `undo`, `redo`).

## views.js (v1 scope)

Three standalone pieces of the JobTracker views system:
- `filterPills({ options, selected, counts?, onChange })` — primary pills + boolean toggles.
- `multiselectDropdown({ label, options, selected, counts?, onChange })` — checklist
  popover with live counts.
- `savedViews({ storageKey, serialize, apply, icons? })` — save/rename/reorder/set-default/
  delete, dirty detection ("Update '<name>'"), share codes (`#view/<code>`).

**Deferred to v2** (too store-coupled to extract cleanly yet): in-grid editing, column
drag/resize, bulk action bar, CSV/XLS export. Keep using app-local implementations.

## tour.js · shortcuts.js · notifications.js · access.js · settings.js

- `startTour(steps)` / `maybeStartTour(steps, { storageKey })` — popover walkthrough.
- `registerShortcuts(map)` + `?` cheat-sheet panel.
- `initBell({ feed, storageKey, mount })` — bell + badge + anchored panel over a derived
  feed; dismissals persisted.
- `access.js` — ECDSA invite/admin token gate (client-side UX gating ONLY — do not call
  it security; real protection is Cloudflare Access, see DOMAINS.md).
- `defineSettings(schema)` + `renderSettings(mount)` — section-based settings pages;
  `getUiMode()/setUiMode(mode)` for `simple|standard|expert`; fields declare `minMode`.

## catalog.js

The fleet registry (vendored data, offline-safe):
`FLEET = [{ id, name, url, tagline, icon, accent, status: 'live'|'beta'|'soon',
changelogUrl, visibility: 'public'|'private' }]`. Single source for the launcher grid
and every app's waffle switcher.

## auth/

`schema.js` (contract + `registerAuthSource`), `null.js` (logged-out default),
`supabase.js` (lazy CDN-ESM stub; config injected at `init()`). See PLATFORM.md.

## sw-template.js

Network-first service-worker template (copy to app root as `sw.js`, set
`CACHE_VERSION`). Never serve stale JS online — builds ship often. **Bump the cache
name in the same commit as any shell adoption** or users see the old UI.

---

# The fleet changelog contract (do not break)

Every app publishes `https://<app>.polecat.live/js/changelog.js`:

```js
export const CHANGELOG = [ // newest first
  { v: 42, title: 'Short human title', kind: 'feature'|'polish'|'fix',
    ts: '2026-07-01T18:20:00Z', items: ['sentence', ...] },
];
export const LATEST_VERSION = CHANGELOG[0].v;
```

Literal JS (unquoted keys, single-quoted strings, escaped apostrophes), no `//` inside
item text, `ts` left empty by authors and stamped by CI in ISO-8601 UTC, displayed in
US Central. Manager's ingest and the launcher both parse this file live.

# Shell standards (release gates for every app)

- **Tiles link to detail.** Any dashboard stat tile, KPI number, or icon-count is a
  link to the filtered detail view behind it. No dead numbers.
- **Mobile is a gate**: Playwright smoke at 390×780 AND desktop, zero pageerrors,
  before any push. Touch targets thumb-sized; rail becomes a drawer.
- **Both themes always**: every screen readable in light and dark, all palettes.
- **Undo over confirmation** where possible; destructive actions get confirmDialog.
- **What's-New stays current**: every user-visible change ships a changelog entry in
  the same commit.

# Migrating an app (checklist)

1. Vendor `lib/` → `vendor/polecat-shell/` (via sync-shell PR).
2. Swap `js/ui.js`/`theme.js`/`icons.js` imports to the vendored modules, passing the
   app's existing storage keys. Delete the app-local copies once green.
3. Adopt `initShell` (keep the app's sections), add `appSwitcher(FLEET)`.
4. Move What's-New into `rightPanel` via `initWhatsNew`.
5. Add `[data-palette]` block or reuse a shipped palette; keep app accents in app CSS.
6. Bump SW cache name. Run smoke (390×780 + desktop). Update the app's CLAUDE.md with
   the vendor read-only rule. Ship a changelog entry.
