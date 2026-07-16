// polecat.live launcher changelog — fleet format (see docs/SHELL-API.md).
// Literal style: unquoted keys, single-quoted strings, escaped apostrophes,
// no // inside item text. Empty ts is stamped by CI at publish time.

export const CHANGELOG = [
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
