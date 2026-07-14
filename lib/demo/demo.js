// demo.js — the Polecat Shell kitchen sink. Exercises every lib module in
// one page; scripts/smoke-test.mjs drives it per palette × mode. This is a
// living reference for app migrations: each section shows the intended way
// to wire a module.

import { configure, applyTheme, getTheme, setTheme, toggleMode, PALETTES } from '../theme.js';
import { el, field, toast, modal, sheet, confirmDialog, promptDialog, anchoredPopover, celebrate, relTime } from '../ui.js';
import { icon, iconNames } from '../icons.js';
import { initShell, rightPanel, appSwitcher } from '../shell.js';
import { initWhatsNew, hasUnseen } from '../whatsnew.js';
import { initBell } from '../notifications.js';
import { createStore } from '../store.js';
import { filterPills, multiselectDropdown, savedViews } from '../views.js';
import { defineSettings, renderSettings, uiModeField, getUiMode, configureUiMode } from '../settings.js';
import { startTour } from '../tour.js';
import { registerShortcuts, openCheatSheet } from '../shortcuts.js';
import { FLEET } from '../catalog.js';
import '../auth/null.js';
import { activeAuth } from '../auth/schema.js';

// ---- theme -----------------------------------------------------------------
configure({ storageKey: 'ps.demo.theme' });
configureUiMode({ storageKey: 'ps.demo.uimode' });
applyTheme();

// ---- demo data (a tiny store with undo) --------------------------------------
const store = createStore({
  storageKey: 'ps.demo.workspace',
  schemaVersion: 1,
  migrations: {},
  seed: { items: [
    { id: 'a1', name: 'Moonlit ride', genre: 'racing',  fav: true },
    { id: 'a2', name: 'Case of the amber key', genre: 'mystery', fav: false },
    { id: 'a3', name: 'Neon harbor', genre: 'arcade',  fav: false },
  ], filters: { genres: [] } },
});

// ---- changelog data for What's-New -------------------------------------------
const DEMO_LOG = [
  { v: 2, title: 'Right panel + waffle', kind: 'feature', ts: new Date(Date.now() - 36e5).toISOString(),
    items: ['The chapter this demo ships in.', 'Everything you see is vendored shell code.'] },
  { v: 1, title: 'Hello, shell', kind: 'polish', ts: new Date(Date.now() - 864e5).toISOString(),
    items: ['First light.'] },
];

// ---- shell -------------------------------------------------------------------
const SECTIONS = [
  { group: 'Demo' },
  { key: 'widgets',  label: 'Widgets',   icon: icon('sparkle', 18) },
  { key: 'views',    label: 'Views',     icon: icon('filter', 18) },
  { key: 'icons',    label: 'Icons',     icon: icon('grid', 18) },
  { group: 'System' },
  { key: 'settings', label: 'Settings',  icon: icon('settings', 18) },
  { key: 'expert',   label: 'Expert bits', icon: icon('terminal', 18), minMode: 'expert' },
  { key: 'admin',    label: 'Admin',     icon: icon('shield', 18), admin: true },
];

const whatsNewBtn = el('button', { class: 'btn icon ghost', title: "What's new", 'aria-label': "What's new", html: icon('sparkle', 18) });
whatsNewBtn.addEventListener('click', () => {
  rightPanel({ title: "What's new", body: initWhatsNew({
    entries: DEMO_LOG, latest: 2, storageKey: 'ps.demo.wn.seen' }) });
});

const themeBtn = el('button', { class: 'btn icon ghost', title: 'Toggle light/dark', 'aria-label': 'Toggle theme', html: icon('moon', 18) });
themeBtn.addEventListener('click', () => { toggleMode(); toast('Theme', { body: `${getTheme().palette} · ${getTheme().mode}`, kind: 'info' }); });

const bell = initBell({
  storageKey: 'ps.demo.notif.dismissed',
  feed: () => [
    { id: 'n1', title: 'Fleet sweep finished', body: '2 apps need attention', kind: 'warn', ts: new Date(Date.now() - 72e5).toISOString() },
    { id: 'n2', title: 'Shell v0.1.0 vendored', kind: 'info', ts: new Date(Date.now() - 6e5).toISOString() },
  ],
});

const shell = initShell({
  app: { id: 'demo', name: 'Shell Demo' },
  sections: SECTIONS,
  onNav: show,
  isAdmin: () => true,
  uiMode: () => getUiMode(),
  rail: { storageKey: 'ps.demo.rail' },
  topbar: {
    left:  [el('h1', { text: 'Polecat Shell' })],
    right: [appSwitcher(FLEET, { current: 'manager' }), bell, whatsNewBtn, themeBtn],
  },
});

// ---- sections ---------------------------------------------------------------
function panelWidgets(){
  const root = el('div');
  root.append(el('h2', { text: 'Feedback primitives', style: 'margin-bottom:12px' }));
  const row = el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px' });
  const b = (label, fn, cls='btn') => { const x = el('button', { class: cls, text: label }); x.addEventListener('click', fn); return x; };
  row.append(
    b('Toast', () => toast('Saved', { body: 'Just like that.', kind: 'ok' })),
    b('Modal', () => modal({ title: 'A modal', body: el('p', { text: 'Escape closes; focus is trapped.' }) })),
    b('Sheet', () => sheet({ title: 'A sheet', body: el('p', { text: 'Slides from the right; data-side picks the edge.' }) })),
    b('Confirm', async () => toast('Result', { body: String(await confirmDialog({ title: 'Sure?', message: 'A yes/no question.' })) })),
    b('Prompt', async () => toast('You typed', { body: (await promptDialog({ title: 'Name it', label: 'Name' })) || '(nothing)' })),
    b('Popover', (e) => {
      const p = el('div', { class: 'pop-menu' });
      p.append(b('Item one', () => toast('one')), b('Item two', () => toast('two')));
      anchoredPopover(e.currentTarget, p);
    }),
    b('Celebrate', () => celebrate(), 'btn primary'),
    b('Tour', () => startTour([
      { sel: '.ps-rail-brand', title: 'The rail', body: 'Collapsible, resizable, drawer on mobile.' },
      { sel: '.ps-waffle-btn', title: 'The waffle', body: 'Every Polecat app, one hop away.' },
    ])),
    b('Shortcuts (?)', () => openCheatSheet()),
  );
  root.append(row);

  root.append(el('h2', { text: 'Store + undo', style: 'margin-bottom:12px' }));
  const list = el('div');
  const paint = () => {
    list.replaceChildren(...store.get().items.map(it =>
      el('div', { style: 'display:flex;align-items:center;gap:8px;padding:6px 0' }, [
        el('span', { class: 't-ic', html: icon(it.fav ? 'star' : 'tag', 16) }),
        el('span', { text: `${it.name} — ${it.genre}` }),
      ])));
  };
  store.on('change', paint); paint();
  const srow = el('div', { style: 'display:flex;gap:8px;margin:10px 0 24px' });
  srow.append(
    b('Add item', () => store.mutate('add', d => d.items.push({ id: 'x' + Date.now(), name: 'New thing ' + (d.items.length + 1), genre: 'arcade', fav: false }))),
    b('Undo', () => store.undo()), b('Redo', () => store.redo()),
  );
  root.append(list, srow);

  root.append(el('h2', { text: 'Auth seam', style: 'margin-bottom:12px' }));
  const who = el('p', { class: 'muted', text: 'checking…' });
  activeAuth().getUser().then(u => who.textContent = u ? `Signed in as ${u.email}` : `Logged-out-first (adapter: ${activeAuth().label})`);
  root.append(who);
  return root;
}

function panelViews(){
  const root = el('div');
  root.append(el('h2', { text: 'Filters + saved views', style: 'margin-bottom:12px' }));
  const genres = ['racing', 'mystery', 'arcade'];
  const state = { genres: [...store.get().filters.genres], fav: false };
  const results = el('p', { class: 'muted' });
  const paint = () => {
    const items = store.get().items.filter(it =>
      (!state.genres.length || state.genres.includes(it.genre)) && (!state.fav || it.fav));
    results.textContent = `${items.length} item(s): ${items.map(i => i.name).join(', ') || '—'}`;
  };
  const pills = filterPills({
    options: [{ key: 'fav', label: 'Favorites', icon: 'star' }],
    selected: [], onChange: (sel) => { state.fav = sel.includes('fav'); paint(); },
  });
  const dd = multiselectDropdown({
    label: 'Genre', options: genres.map(g => ({ key: g, label: g })),
    selected: state.genres,
    counts: Object.fromEntries(genres.map(g => [g, store.get().items.filter(i => i.genre === g).length])),
    onChange: (sel) => { state.genres = sel; paint(); },
  });
  const sv = savedViews({
    storageKey: 'ps.demo.views',
    serialize: () => ({ ...state }),
    apply: (s) => { Object.assign(state, s); paint(); toast('View applied'); },
  });
  const bar = el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px' });
  bar.append(pills, dd, sv.node);
  root.append(bar, results);
  paint();
  return root;
}

function panelIcons(){
  const root = el('div');
  root.append(el('h2', { text: `Icon set (${iconNames().length})`, style: 'margin-bottom:12px' }));
  const grid = el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(86px,1fr));gap:8px' });
  iconNames().sort().forEach(n => grid.append(
    el('div', { style: 'display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px 4px;border:1px solid var(--border);border-radius:10px' }, [
      el('span', { html: icon(n, 20) }), el('span', { class: 'tiny muted', text: n }),
    ])));
  root.append(grid);
  return root;
}

defineSettings({
  storageKey: 'ps.demo.settings',
  sections: [
    { key: 'appearance', title: 'Appearance', blurb: 'Palette and mode persist per browser.', fields: [
      uiModeField(),
      { key: 'palette', label: 'Palette', type: 'custom', render(){
          const seg = el('div', { class: 'ps-seg', role: 'radiogroup' });
          PALETTES.forEach(p => {
            const on = getTheme().palette === p;
            const btn = el('button', { class: 'ps-seg-btn' + (on ? ' on' : ''), text: p });
            btn.addEventListener('click', () => {
              setTheme(p, getTheme().mode);
              seg.querySelectorAll('.ps-seg-btn').forEach(x => x.classList.toggle('on', x === btn));
            });
            seg.append(btn);
          });
          return seg;
        } },
      { key: 'confettiOnSave', label: 'Celebrate on save', hint: 'Tiny joy, opt-out.', type: 'toggle', def: true },
    ] },
    { key: 'advanced', title: 'Advanced', minMode: 'expert', fields: [
      { key: 'endpoint', label: 'Custom backend URL', hint: 'Bring your own (GPL-3).', type: 'text', def: '' },
    ] },
  ],
});

function panelSettings(){
  const root = el('div');
  renderSettings(root, { isAdmin: true });
  window.addEventListener('polecat:uimode', () => { renderSettings(root, { isAdmin: true }); }, { once: true });
  return root;
}

const PANELS = {
  widgets: panelWidgets, views: panelViews, icons: panelIcons, settings: panelSettings,
  expert: () => el('p', { text: 'Only visible in expert mode.' }),
  admin: () => el('p', { text: 'Only visible to admins.' }),
};

function show(key){
  shell.setActive(key);
  shell.els.main.replaceChildren((PANELS[key] || PANELS.widgets)());
}

registerShortcuts([
  { combo: 'mod+z', label: 'Undo', group: 'Editing', handler: () => store.undo() },
  { combo: 'mod+shift+z', label: 'Redo', group: 'Editing', handler: () => store.redo() },
  { combo: 'w', label: 'Go to widgets', group: 'Navigate', handler: () => show('widgets') },
]);

shell.setBadge('widgets', 3);
if(hasUnseen('ps.demo.wn.seen', 2)) whatsNewBtn.classList.add('has-unseen');
show('widgets');
