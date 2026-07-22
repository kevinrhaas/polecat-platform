// polecat.live launcher changelog — fleet format (see docs/SHELL-API.md).
// Literal style: unquoted keys, single-quoted strings, escaped apostrophes,
// no // inside item text. Empty ts is stamped by CI at publish time.

export const CHANGELOG = [
  { v: 12, title: 'The app grid, reordered — and a couple of tiles just for fun', kind: 'improvement', ts: '2026-07-22T18:26:00Z',
    items: [
      'The apps are laid out in a new order on the home grid, leading with Chat, Analytics, and Model Server.',
      'AutoSelector and Games now wear a little “for fun” tag — they’re built for the joy of it.',
    ] },
  { v: 11, title: 'One footer for the whole suite', kind: 'improvement', ts: '2026-07-22T16:33:58Z',
    items: [
      'The footer now uses the shared fleet chrome that every Polecat app is adopting, so the whole suite reads as one — the sharp Pole·cat wordmark stays put.',
      'Dropped the old What’s-new footer link.',
    ] },
  { v: 10, title: 'Connect with us', kind: 'feature', ts: '2026-07-22T15:22:10Z',
    items: [
      'A new Connect section lets you reach out for access to a private app, a question about a build, or a problem worth solving — it comes straight to us.',
      'Requests are captured in Supabase when configured, and otherwise open a pre-filled email, so a note never gets lost.',
    ] },
  { v: 9, title: 'Chat moved to chat.polecat.live', kind: 'improvement', ts: '2026-07-18T04:56:32Z',
    items: [
      'The Chat tile and every app switcher now point at chat.polecat.live, the app\'s new permanent home.',
      'The old app.polecat.live keeps a friendly forwarding page that carries your chats, keys and settings across in one tap.',
    ] },
  { v: 8, title: 'Biography, in the right order', kind: 'improvement', ts: '2026-07-16T20:09:18Z',
    items: [
      'About now tells it the way it happened: Florida, then Northwestern, then Chicago ever since.',
    ] },
  { v: 7, title: 'A proper front-door address', kind: 'improvement', ts: '2026-07-16T17:56:47Z',
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
  { v: 4, title: 'New hero headline — built to fit', kind: 'improvement', ts: '2026-07-16T16:37:29Z',
    items: [
      'The front door now opens with "Data, analytics & apps — built to fit." — the page title and social cards match.',
    ] },
  { v: 3, title: 'Copy tune-up — the work speaks, not the headcount', kind: 'improvement', ts: '2026-07-16T16:15:29Z',
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
