# Polecat Brand Standards

The first cut of the fleet's visual identity. Its job is to make eight
independently-built apps read as one suite — the same brand mark treatment,
the same header and footer, the same icon family, the same palette logic —
without flattening each app's own character. Living document: it starts from
what the fleet already ships and grows as the identity matures. When code and
this doc disagree, fix whichever is wrong in the same PR.

> **The Polecat mark** is the monoline head-and-tail in a ring.
> **`site/assets/logo-mark.svg` is the canonical vector** (fill:
> `currentColor`, defaults to black). **The one rule (brand v2, 2026-07-30):
> the mark is dark on a light ground — ALWAYS.**
>
> 1. **Light surfaces** — the bare black mark sits directly on the surface
>    (`#FFFFFF`, `#FBF7F1`, cream `#F5E9D6`).
> 2. **Dark surfaces, including dark mode** — never knock the mark out to
>    white. Keep it dark on a light round **coin** that echoes its own ring:
>    cream `#F5E9D6` on the warm site dark and brand-orange surfaces, white
>    where cream clashes (the cooler app dark). Coins are full-bleed circles
>    with the mark at 85% — padding built in (CSS: circle background +
>    ~7.5% padding on the bare mark, see `site/css/site.css .brand-mark`).
> 3. **Light-on-dark is the exception, not an option** — allowed only where a
>    coin is physically impossible (single-color reverse print, monochrome OS
>    masks). `filter: invert(1)` on the mark is retired.
>
> Clear space ≥ the ring's stroke width (~7% of mark width); minimum 24px on
> screen; one color only — no gradients, no accent fills, no recoloring, and
> never the bare black mark on a dark surface "for subtlety".
> **Favicon/PWA:** `site/assets/favicon.svg` IS the cream coin — it keeps the
> mark dark-on-light even in dark browser chrome (the scheme-aware white
> variant is retired). The legacy mascot (`site/assets/polecat.svg`) stays
> retired — never on new work, never on app pages. The master mark lives on
> polecat.live (and the app.polecat.live stub) only — apps identify with
> their own glyph tile (below), never the polecat.

## Voice

Open-source software for targeted problems, built at agent scale. Direct,
honest, a little cheeky; never corporate. "Elegant, modern, joyful" is a
requirement, not decoration. We say what a thing does, then prove it.

## The mark system: one chassis, a glyph per app

Every app is represented by a **single-color glyph in a shared round badge**.
The chassis is the constant that makes the family cohere; the glyph and accent
make each app itself. **No gradients anywhere in the mark system** — the old
gradient-square tiles are retired.

- **Chassis** (`.psx-tile`, the launcher's `.app-glyph`, the rail's
  `.ps-rail-logo`): a **circle** — ring weight ≈7.5% of size, background
  `color-mix(accent 10%, transparent)`, glyph in the accent color at ~60% of
  size. Small/busy surfaces use the **solid variant**: accent disc, white
  glyph (`.psx-tile-sm`).
- **Glyph**: one icon from `lib/icons.js` — single-color, `currentColor`,
  stroke-based, 24×24, stroke-width 1.7 (the fleet icon bar; never multi-color
  or filled). Chosen to say what the app *does*.
- **Accent**: one hex per app, from `lib/catalog.js` (the single source of
  truth). It tints the badge and the app's primary CTA. Chrome text/surfaces
  still follow the viewer's theme, never the brand color.

### The per-app assignments (canonical — from `lib/catalog.js`)

| App | Glyph | Accent → Accent 2 | Notes |
|-----|-------|-------------------|-------|
| **polecat.live** | the Polecat mark | house gradient¹ | the master mark; reserved |
| Chat | `chat` | `#8b5cf6` → `#6366f1` violet | |
| JobTracker | `briefcase` | `#1a8fd6` → `#12a24f` blue-green | landing page currently shows a rocket → move to briefcase |
| Analytics | `chart` | `#d4773b` → `#f55036` terracotta | |
| AutoSelector | `car` | `#3e7bfa` → `#f0762f` blue | |
| Relay | `network` | `#21c7a8` → `#12b3a0` teal | landing page currently reads orange → reconcile to teal² |
| Games | `gamepad` | `#ff2e97` → `#b14dff` neon pink | neon palette is intentional (arcade) |
| Manager | `gauge` | `#22d3ee` → `#38bdf8` cyan | mission-control gauge |
| Model Server | `terminal` | `#d4773b` → `#e8994a` brown-orange | landing page currently inlines the mascot → move to terminal glyph |

(Values mirror `lib/catalog.js` — re-check there when editing; the catalog
wins on any disagreement. `accent2` survives as the gradient stop for
non-mark uses — an app's favicon, a hero flourish — never the badge itself.)

¹ House gradient: `linear-gradient(110deg, #9C6B3F, #e08a45 45%, #F4A6A6)`.
² Teal keeps the eight tiles chromatically distinct (Relay orange would collide
with Model Server's brown-orange and Analytics' terracotta) and reads on-theme
for a mesh/relay app. Relay's landing hero still uses orange — a follow-up
harmonization, not part of the chrome rollout.

## Palette

**House palette** (polecat.live, the master identity):

| Token | Hex | Use |
|-------|-----|-----|
| `--brand-a` | `#9C6B3F` | polecat brown |
| `--brand-b` | `#e08a45` | orange (primary accent, links) |
| `--blush` | `#F4A6A6` | blush (gradient tail) |
| `--cream` | `#F5E9D6` | warm light |
| glow | `#b070f0` | purple ambient glow only |

**Neutrals** (dark surfaces the whole fleet shares): bg `#0b0a10`, surface
`#16131f`, border `#2c2738`, text `#f1edf7`, muted `#a59fb8`, faint `#6b6480`.
Fleet landing pages are dark today; the chrome ships a light fallback so that
assumption isn't baked in.

**App accents**: the per-app hexes above. An accent should appear as the tile
tint and the primary CTA — a spark of the app's color, not a full repaint of
neutral chrome.

## Typography

**Hanken Grotesk is the brand face**, self-hosted as woff2 in `lib/fonts/`
(`lib/fonts.css` carries the `@font-face` set: 400/500/600/700/800 roman +
400 italic, all `font-display: swap`). **800 is the brand weight** — every
heading, wordmark, kicker, stat number and app name. 600 carries controls and
rail items. The system stack always sits right behind it, so pages that don't
link `fonts.css` (or users mid-download) render instantly on system type.

- **Site scale** (fluid, polecat.live + front doors): h1
  `clamp(38px, 6.4vw, 66px)` / `-1.5px` / `1.05`; h2 `clamp(24px, 4vw, 36px)`
  / `-.8px` / `1.15`; body 15px/1.6; kickers 12px/800/uppercase/`+1.5px`.
- **App scale** (fixed, Polecat Shell): 14px/1.5 base with the control ladder
  (13.5px controls, 12px pills, 11.5px chips, 10px rail group labels).
- **Mono** (`--mono`) is for versions, object IDs, keyboard hints and `<kbd>`
  only.
- Adoption: link `vendor/polecat-shell/fonts.css`, then set the page's stack
  from `--font` (app) or `--font-site` (marketing chrome). Preload the 400 and
  800 woff2 on pages where the headline is the hero.

## Header standard

One sticky header on every app front door, built by
`siteHeader()` (`lib/site-chrome.js` + `site-chrome.css`):

- **Left — brand**: the app's glyph tile + the app name, linking to the app's
  own home (`/`). No `polecat.live` text glued to the wordmark anymore.
- **Center/right — the app's own sections**: `Features`, `How it works`, etc.
  (these stay per-app; they collapse on mobile).
- **Primary CTA**: the accent-filled pill (`Launch app`, `Open console`, …).
  Launching the app **opens in a new tab** across the suite (so the marketing
  page stays put) — the footer's `App` link does the same.
- **Right edge — the suite affordance**: a muted **`Polecat ↗`** wordmark link
  to `https://polecat.live`. This is the *consistent* "back to the suite" path
  the fleet was missing — same place, same treatment, every app.

## Footer standard

One footer, two lines, built by `siteFooter()`:

```
AppName · part of the polecat.live suite
Docs · App · Third-party notices · © 2026 Polecat.live
```

- Line 1: the app glyph tile + name, then "part of the polecat.live suite"
  (`polecat.live` is a link). One wording — "suite", never "family"/"part of".
- Line 2: `Docs · App · Third-party notices · © YEAR Polecat.live`. Each link
  is optional in the builder but the canonical set is all three; give every app
  a `THIRD-PARTY-NOTICES.md` so the link is real.

**polecat.live's own footer** is the root variant: it keeps the sharp
**Pole·cat** wordmark on top, a suite links row, and the © meta — same
typography and separators as the app footers, but no "part of the suite" line
(it *is* the suite) and **no "What's new" link**.

## In-app rail brand standard

The marketing chrome above is the front door; inside the app the left rail
carries the matching brand mark, built by `initShell({ app })` (`lib/shell.js`):

- **The glyph tile**: pass `app.icon: icon('<catalogGlyph>', 22)` — the app's
  own catalog glyph (gauge, chart, briefcase, …), the *same* mark as its
  launcher tile and its marketing header. `app.wordmark` is a legacy fallback
  only; new adoptions pass `app.icon`. The tile is the round ring badge
  (accent-colored glyph on a 10% wash), matching the launcher and header.
- **The app name** sits beside the tile (shown when the rail is open).
- **The suite link**: a *barely-there* `polecat.live` link under the name —
  opacity `.45` at rest, `.9` on hover — the in-app echo of the marketing
  header's `Polecat ↗`. Visible if you look, never shouting. Opens the suite in
  a new tab. It hides with the labels when the rail collapses to icons.

One naming rule across all three surfaces (launcher tile, marketing header,
in-app rail): same glyph, same app name, same accent. If they disagree, the
catalog (`lib/catalog.js`) wins.

**One brand color, one badge treatment.** All three surfaces render the
**same round single-color ring badge** (ring ≈7.5% of size, 10% accent wash,
stroke glyph in the accent): the launcher `.app-glyph`, the marketing
`.psx-tile`, and the in-app rail `.ps-rail-logo` (which auto-reads the catalog
by `app.id`, so no per-app color wiring). An app's icon reads the same color
and style whether you see it on the launcher, its landing page, or inside the
app. Gradient tiles (`linear-gradient(140deg, accent, accent2)`) are retired
from the mark system; `accent2` remains in the catalog for favicons and
non-mark flourishes.

## Adoption

1. The app vendors the shell (arrives via a `chore: polecat-shell vX.Y.Z` sync
   PR — `site-chrome.js` + `site-chrome.css` ship with it).
2. The marketing page drops its bespoke `<header>`/`<footer>` markup for two
   mount points and:
   ```html
   <link rel="stylesheet" href="/vendor/polecat-shell/site-chrome.css">
   <header id="siteHeader"></header> … <footer id="siteFooter"></footer>
   <script type="module">
     import { siteHeader, siteFooter } from '/vendor/polecat-shell/site-chrome.js';
     siteHeader('#siteHeader', { app:'<id>', nav:[…], cta:{ href:'/app/', label:'Launch app' } });
     siteFooter('#siteFooter', { app:'<id>', docs:'/app/#docs', appUrl:'/app/', notices:'THIRD-PARTY-NOTICES.md' });
   </script>
   ```
3. Keep the page's own hero/sections; only the chrome is shared.

## Known drift to reconcile (tracked)

- **JobTracker** landing brand mark is a rocket → should be the `briefcase` glyph.
- **Relay** landing hero is orange → catalog accent is teal (canonical); harmonize the hero later.
- **Model Server** landing inlines the full mascot → should be the `terminal` glyph tile.
- **Analytics** already ships very close to this footer spec — it was the model for it.
