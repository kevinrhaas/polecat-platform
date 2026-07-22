# Polecat Brand Standards

The first cut of the fleet's visual identity. Its job is to make eight
independently-built apps read as one suite — the same brand mark treatment,
the same header and footer, the same icon family, the same palette logic —
without flattening each app's own character. Living document: it starts from
what the fleet already ships and grows as the identity matures. When code and
this doc disagree, fix whichever is wrong in the same PR.

> The **Polecat mascot** (the masked cat face, `site/assets/polecat.svg`) is the
> master mark and is getting its own focused design pass later. Until then:
> keep it exactly as-is on polecat.live, and do **not** copy the mascot art into
> app pages — apps identify with their own glyph tile (below), not the cat.

## Voice

Open-source software for targeted problems, built at agent scale. Direct,
honest, a little cheeky; never corporate. "Elegant, modern, joyful" is a
requirement, not decoration. We say what a thing does, then prove it.

## The mark system: one chassis, a glyph per app

Every app is represented by a **single-color glyph in a shared tile** — the
same rounded, accent-tinted square the launcher grid already uses. The chassis
is the constant that makes the family cohere; the glyph and accent make each
app itself.

- **Chassis** (`.psx-tile`, and the launcher's `.app-glyph`): rounded square,
  `border-radius` ~30% of size, background `color-mix(accent 15%, transparent)`,
  `1px` border `color-mix(accent 32%, transparent)`, glyph in the accent color.
- **Glyph**: one icon from `lib/icons.js` — single-color, `currentColor`,
  stroke-based, 24×24, stroke-width 1.7 (the fleet icon bar; never multi-color
  or filled). Chosen to say what the app *does*.
- **Accent**: one hex per app, from `lib/catalog.js` (the single source of
  truth). It tints the tile and the app's primary CTA. Chrome text/surfaces
  still follow the viewer's theme, never the brand color.

### The per-app assignments (canonical — from `lib/catalog.js`)

| App | Glyph | Accent | Notes |
|-----|-------|--------|-------|
| **polecat.live** | the mascot (cat face) | house gradient¹ | the master mark; reserved |
| Chat | `chat` | `#8b5cf6` violet | |
| JobTracker | `briefcase` | `#7c5cff` purple | landing page currently shows a rocket → move to briefcase |
| Analytics | `chart` | `#b8632e` terracotta | |
| AutoSelector | `car` | `#2f81f7` blue | |
| Relay | `network` | `#21c7a8` teal | landing page currently reads orange → reconcile to teal² |
| Games | `gamepad` | `#ff2e97` neon pink | neon palette is intentional (arcade) |
| Manager | `gauge` | `#38bdf8` sky | mission-control gauge |
| Model Server | `terminal` | `#d4773b` brown-orange | landing page currently inlines the mascot → move to terminal glyph |

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

## Header standard

One sticky header on every app front door, built by
`siteHeader()` (`lib/site-chrome.js` + `site-chrome.css`):

- **Left — brand**: the app's glyph tile + the app name, linking to the app's
  own home (`/`). No `polecat.live` text glued to the wordmark anymore.
- **Center/right — the app's own sections**: `Features`, `How it works`, etc.
  (these stay per-app; they collapse on mobile).
- **Primary CTA**: the accent-filled pill (`Launch app`, `Open console`, …).
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
