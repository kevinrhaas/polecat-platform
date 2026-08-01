// polecat.live launcher changelog — fleet format (see docs/SHELL-API.md).
// Literal style: unquoted keys, single-quoted strings, escaped apostrophes,
// no // inside item text. Empty ts is stamped before merge by
// scripts/stamp-changelog.mjs.

export const CHANGELOG = [
  { v: 26, title: 'The "100% open source" stat no longer flickers through fake percentages', kind: 'fix', ts: '2026-08-01T15:14:04Z',
    items: [
      'The stats-band count-up animation was meant to leave percentage figures alone and only count up plain numbers, but a bug let "100% open source" animate anyway, flashing through nonsensical values like "21%" and "62%" on its way up. It now skips straight to 100%.',
    ] },
  { v: 25, title: 'The mark never goes white: coins on every dark surface', kind: 'polish', ts: '2026-07-30T23:36:23Z',
    items: [
      'New brand rule, applied everywhere the mark appears: it stays dark on a light ground, always. On dark surfaces it now sits on a small cream coin that echoes its own ring, instead of being flipped to white.',
      'The nav mark, the floating hero mark, the share card, and the favicon all wear the coin now — the favicon no longer swaps to a white mark in dark browser chrome.',
    ] },
  { v: 24, title: 'The mark goes vector', kind: 'polish', ts: '2026-07-30T23:36:23Z',
    items: [
      'The new Polecat mark is now a true vector — 3 KB of paths instead of a megabyte of pixels — so it renders razor-sharp at every size, from the favicon to the hero.',
      'The favicon is the new mark at last (the old mascot\'s final post), and it adapts to your browser theme: ink on light, warm white on dark.',
      'The share card regenerated from the vector, crisper than before.',
    ] },
  { v: 23, title: 'The design system arrives: new mark, brand typeface, round app badges', kind: 'feature', ts: '2026-07-30T23:36:23Z',
    items: [
      'The new monoline Polecat mark replaces the old mascot in the nav, the hero, and the share card. One drawn line, head and tail in a ring — same animal, sharper suit.',
      'The whole site now sets in Hanken Grotesk, the fleet\'s brand face — self-hosted, swap-displayed, and preloaded so first paint stays instant. Display type got a touch bigger to match.',
      'App tiles across the launcher are now round single-color ring badges instead of gradient squares — the same object you\'ll see in every app\'s header and rail as the fleet picks up the new shell.',
      'Under the hood: the full design-token vocabulary (type scale, spacing, motion, shadows) now drives the page, and the design system ships in the repo as a skill so every future change designs on-system.',
    ] },
  { v: 22, title: 'Bigger tap targets in the mobile nav and footer', kind: 'fix', ts: '2026-07-28T19:18:55Z',
    items: [
      'The four links inside the mobile hamburger drawer (Apps, How we build, What I do, About) were only 35px tall, under this site\'s own 44px minimum for everything else in the nav. They\'re a full 44px now.',
      'Footer links (Apps, Consulting, Connect, LinkedIn) were 22px tall, under the WCAG minimum tap size. Gave them breathing room so they clear it.',
    ] },
  { v: 21, title: 'Caught the front door up to its own shell', kind: 'fix', ts: '2026-07-28T13:45:35Z',
    items: [
      'This site vendors its own copy of the Polecat Shell it hands out to every other app. That copy had drifted a step behind, so it was quietly serving an unpinned sign-in library instead of the exact version everywhere else runs. Re-synced.',
    ] },
  { v: 20, title: 'Printing the page no longer leaves it half blank', kind: 'fix', ts: '2026-07-28T09:37:39Z',
    items: [
      'Sections below the fold fade in as you scroll, which meant printing or saving the page as a PDF without scrolling through it first left most of the page blank. Printing now shows everything.',
    ] },
  { v: 19, title: 'A light theme, and a switch to flip it', kind: 'feature', ts: '2026-07-28T00:59:50Z',
    items: [
      'polecat.live was dark-only since launch. There\'s now a light theme too — same warm-amber brand, a cream-and-white surface instead — and a sun/moon button in the top nav to switch. Your choice is remembered and applied before the page paints, so there\'s no flash.',
    ] },
  { v: 18, title: 'The hero stats actually go somewhere now', kind: 'polish', ts: '2026-07-28T00:52:01Z',
    items: [
      'The four numbers up top — live apps, releases shipped, open source, meetings held — are clickable now, same as every other tile on the page. They jump to the app grid, the GitHub profile, or the consulting section.',
    ] },
  { v: 17, title: 'A proper share card', kind: 'polish', ts: '2026-07-27T23:40:10Z',
    items: [
      'Sharing polecat.live in Slack, iMessage, or X now shows a real card — the mark, the house gradient, and the headline — instead of a blank preview.',
    ] },
  { v: 16, title: 'A real mobile menu — no more vanishing nav links', kind: 'fix', ts: '2026-07-27T22:38:29Z',
    items: [
      'On phones, Apps, How we build, What I do, and About used to just disappear from the top nav with no way to reach them. A hamburger menu now opens a proper drawer with all four.',
    ] },
  { v: 15, title: 'One brand color per app, everywhere you see it', kind: 'polish', ts: '2026-07-22T20:45:00Z',
    items: [
      'Every app tile is now a vivid gradient in that app’s own brand color — Relay green, JobTracker blue-green, Analytics terracotta — and the same color follows the app onto its home page and inside the app itself, so an icon reads the same everywhere.',
      'Softened the closing invitation — less of a pitch, more of an open door.',
    ] },
  { v: 14, title: 'A calmer, cooler front door — drifting aurora, no more cursor glow', kind: 'polish', ts: '2026-07-22T20:15:00Z',
    items: [
      'The home page now wears the same drifting aurora backdrop as the Manager and JobTracker apps — three soft color fields moving slowly behind everything.',
      'Retired the glow that chased your mouse; the ambient aurora carries the mood instead.',
    ] },
  { v: 13, title: 'Apps open in a new tab', kind: 'polish', ts: '2026-07-22T19:18:14Z',
    items: [
      'Clicking an app on the home grid now opens it in a new tab, so the launcher stays put behind it.',
    ] },
  { v: 12, title: 'The app grid, reordered — and a couple of tiles just for fun', kind: 'polish', ts: '2026-07-22T18:26:00Z',
    items: [
      'The apps are laid out in a new order on the home grid, leading with Chat, Analytics, and Model Server.',
      'AutoSelector and Games now wear a little “for fun” tag — they’re built for the joy of it.',
    ] },
  { v: 11, title: 'One footer for the whole suite', kind: 'polish', ts: '2026-07-22T16:33:58Z',
    items: [
      'The footer now uses the shared fleet chrome that every Polecat app is adopting, so the whole suite reads as one — the sharp Pole·cat wordmark stays put.',
      'Dropped the old What’s-new footer link.',
    ] },
  { v: 10, title: 'Connect with us', kind: 'feature', ts: '2026-07-22T15:22:10Z',
    items: [
      'A new Connect section lets you reach out for access to a private app, a question about a build, or a problem worth solving — it comes straight to us.',
      'Requests are captured in Supabase when configured, and otherwise open a pre-filled email, so a note never gets lost.',
    ] },
  { v: 9, title: 'Chat moved to chat.polecat.live', kind: 'polish', ts: '2026-07-18T04:56:32Z',
    items: [
      'The Chat tile and every app switcher now point at chat.polecat.live, the app\'s new permanent home.',
      'The old app.polecat.live keeps a friendly forwarding page that carries your chats, keys and settings across in one tap.',
    ] },
  { v: 8, title: 'Biography, in the right order', kind: 'polish', ts: '2026-07-16T20:09:18Z',
    items: [
      'About now tells it the way it happened: Florida, then Northwestern, then Chicago ever since.',
    ] },
  { v: 7, title: 'A proper front-door address', kind: 'fix', ts: '2026-07-16T17:56:47Z',
    items: [
      'The Email button now reaches kevin.haas@polecat.live.',
    ] },
  { v: 6, title: 'The spotlight goes everywhere', kind: 'fix', ts: '2026-07-16T17:12:37Z',
    items: [
      'The pointer spotlight now follows you across the whole page, blended so it lights the backdrop without washing out text.',
      'Fixed the hard vertical seam on wide screens — the glow was clipping against the hero content box.',
    ] },
  { v: 5, title: 'The front door gets sexier — glamour layer v2', kind: 'feature', ts: '2026-07-16T16:42:45Z',
    items: [
      'The hero now enters in a staggered rise, carries a pointer-following spotlight, and the mascot wiggles when poked.',
      'An endless ticker of the stack drifts under the hero — Pentaho to BigQuery to agent-driven development.',
      'App cards tilt in 3D toward your pointer with a shine sweep; method cards wear big gradient numbers; grids cascade into view.',
      'A gradient scroll-progress thread tops the page, film grain textures it, and the final call-to-action breathes inside a halo.',
      'Every effect respects reduced-motion and touch devices get the calm version.',
    ] },
  { v: 4, title: 'New hero headline — built to fit', kind: 'polish', ts: '2026-07-16T16:37:29Z',
    items: [
      'The front door now opens with "Data, analytics & apps — built to fit." — the page title and social cards match.',
    ] },
  { v: 3, title: 'Copy tune-up — the work speaks, not the headcount', kind: 'polish', ts: '2026-07-16T16:15:29Z',
    items: [
      'The consulting card once headlined by a product is now "Data, end to end" — open-source depth (Pentaho full-platform, Mondrian, and the wider OSS data stack) moves into the body where it belongs.',
      'Dialed back the one-person emphasis across the sales sections; the collective-of-one brand line stays where it earns its keep.',
      'The stats band now counts the meetings held: zero.',
    ] },
  { v: 2, title: 'The collective of one — the front door grows up', kind: 'feature', ts: '2026-07-16T15:46:04Z',
    items: [
      'polecat.live now tells the whole story: open-source software for targeted problems, built at agent scale by a collective of one — plus the thirty years of enterprise data, analytics, and AI consulting behind it.',
      'New sections: The Idea (why targeted beats platform), How We Build (the PR-gated agent factory), What I Do (six consulting practice areas and the four-level advantage), and About Kevin, with a LinkedIn link.',
      'Live stats band — app count and total releases shipped are summed from the fleet\u2019s own changelogs.',
      'Chat is now simply one app among equals on the launcher grid.',
    ] },
  { v: 1, title: 'The suite front door', kind: 'feature', ts: '2026-07-16T15:46:04Z',
    items: [
      'polecat.live becomes the home of the whole suite: a marketing front door plus a live app launcher.',
      'Launcher grid renders every public app from the fleet catalog with live version and ship-time status ingested from each app’s changelog — fully offline-safe.',
      'Sign-in surface wired to the new auth adapter seam (logged-out-first; Google/Apple/email arrive with the Supabase phase).',
      'Built on Polecat Shell v0.1.0 — the new shared library extracted from the fleet’s best implementations.',
    ] },
];

export const LATEST_VERSION = CHANGELOG[0].v;
