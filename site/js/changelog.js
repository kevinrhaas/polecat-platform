// polecat.live launcher changelog — fleet format (see docs/SHELL-API.md).
// Literal style: unquoted keys, single-quoted strings, escaped apostrophes,
// no // inside item text. Empty ts is stamped by CI at publish time.

export const CHANGELOG = [
  { v: 1, title: 'The suite front door', kind: 'feature', ts: '',
    items: [
      'polecat.live becomes the home of the whole suite: a marketing front door plus a live app launcher.',
      'Launcher grid renders every public app from the fleet catalog with live version and ship-time status ingested from each app’s changelog — fully offline-safe.',
      'Sign-in surface wired to the new auth adapter seam (logged-out-first; Google/Apple/email arrive with the Supabase phase).',
      'Built on Polecat Shell v0.1.0 — the new shared library extracted from the fleet’s best implementations.',
    ] },
];

export const LATEST_VERSION = CHANGELOG[0].v;
