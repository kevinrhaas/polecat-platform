// main.js — renders the launcher grid from the vendored fleet catalog, then
// layers live status (latest version + ship time) from each app's changelog.
// The static render never waits on the network: offline, every card still
// works as a plain link.

import { publicFleet } from '../vendor/polecat-shell/catalog.js';
import { icon } from '../vendor/polecat-shell/icons.js';
import { relTime } from '../vendor/polecat-shell/ui.js';
import { siteFooter } from '../vendor/polecat-shell/site-chrome.js';
import { appStatus } from './ingest.js';
import { initAuthUi } from './auth-ui.js';
import { initConnect } from './connect.js';

const grid = document.getElementById('appsGrid');

// Launcher display order (a polecat.live presentation choice — the shared
// catalog stays in its own order for every app's waffle). Anything not listed
// falls to the end in catalog order.
const ORDER = ['chat', 'analytics', 'modelserver', 'relay', 'jobtracker', 'manager', 'autoselector', 'games'];
// The two we build mostly for the joy of it — tagged "for fun" on the grid.
const FUN = new Set(['autoselector', 'games']);

function card(app){
  const a = document.createElement('a');
  a.className = 'app-card reveal';
  a.href = app.url;
  a.target = '_blank';          // open apps in a new tab, leaving the launcher put
  a.rel = 'noopener';
  a.style.setProperty('--c', app.accent);
  a.innerHTML = `
    <div class="app-top">
      <div class="app-glyph">${icon(app.icon, 24)}</div>
      <div>
        <div class="app-name">${app.name}${FUN.has(app.id) ? '<span class="app-fun">for fun</span>' : ''}</div>
        <div class="app-host">${new URL(app.url).host}</div>
      </div>
    </div>
    <div class="app-tagline">${app.tagline}</div>
    <div class="app-status" data-status>
      <span class="app-dot${app.status === 'live' ? '' : ' soon'}"></span>
      <span>${app.status === 'live' ? 'Live' : 'Coming soon'}</span>
    </div>
    <span class="app-open" aria-hidden="true">${icon('arrowRight', 18)}</span>`;
  return a;
}

async function hydrate(app, el){
  const s = await appStatus(app);
  if(!s || !s.v) return 0; // offline / unreachable → static card stands
  const row = el.querySelector('[data-status]');
  row.innerHTML = `
    <span class="app-dot"></span>
    <span>v${s.v}${s.ts ? ` · shipped ${relTime(s.ts)}` : ''}</span>`;
  return s.v;
}

const apps = publicFleet().slice().sort((a, b) => {
  const ia = ORDER.indexOf(a.id), ib = ORDER.indexOf(b.id);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
});
const els = apps.map(card);
grid.replaceChildren(...els);
grid.setAttribute('aria-busy', 'false');

// A little bonus: a barely-there mark tucked in the corner that opens Kevin's
// workshop of made things. Hidden in plain sight — faint until you find it.
const mystery = document.createElement('a');
mystery.className = 'mystery';
mystery.href = 'https://kevinrhaas.github.io/custom/';
mystery.target = '_blank';
mystery.rel = 'noopener';
mystery.setAttribute('aria-label', 'a workshop of made things');
mystery.title = '?';
mystery.textContent = '◆';
document.body.appendChild(mystery);

// Live stats band: app count is static truth; the releases figure sums each
// app's LATEST_VERSION (version numbers ≈ shipped releases). Falls back to
// the hardcoded copy when offline — never show a lower live number than the
// static one.
const appStat = document.querySelector('[data-stat="apps"]');
if(appStat) appStat.textContent = apps.filter(a => a.status === 'live').length;
let releaseSum = 0, hydrated = 0;
const relStat = document.querySelector('[data-stat="releases"]');
apps.forEach((app, i) => {
  if(app.status !== 'live') return;
  hydrate(app, els[i]).then(v => {
    if(v){ releaseSum += v; hydrated++; }
    if(relStat && hydrated >= 3 && releaseSum > 900) relStat.textContent = releaseSum.toLocaleString() + '+';
  });
});

// scroll reveal (matches the original polecat site behavior)
const io = new IntersectionObserver((entries) => {
  for(const e of entries) if(e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target); }
}, { threshold: .08 });
document.querySelectorAll('.reveal').forEach(el => io.observe(el));

// stats count up from zero when the band scrolls into view (skipped for
// reduced-motion users — they get the final numbers immediately)
const band = document.getElementById('statsBand');
if(band && !matchMedia('(prefers-reduced-motion: reduce)').matches){
  const so = new IntersectionObserver((entries) => {
    if(!entries.some(e => e.isIntersecting)) return;
    so.disconnect();
    band.querySelectorAll('.stat b').forEach(el => {
      const raw = el.textContent;
      const target = parseInt(raw.replace(/[^0-9]/g, ''), 10);
      if(!target || target < 2) return;               // "1", "100%" stay put
      const suffix = /\+/.test(raw) ? '+' : (/%/.test(raw) ? '%' : '');
      const t0 = performance.now(), dur = 1100;
      const tick = (t) => {
        const p = Math.min(1, (t - t0) / dur), eased = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.round(target * eased).toLocaleString() + suffix;
        if(p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }, { threshold: .4 });
  so.observe(band);
}

initAuthUi(document.getElementById('signInBtn'));
initConnect(document.getElementById('connectForm'));

// ── glamour v2: scroll progress + card tilt (the drifting aurora backdrop is
// pure CSS — see .aurora in site.css). The old pointer-following spotlight was
// removed; the aurora carries the ambient glow now.
// All motion-gated: nothing runs for reduced-motion users, and the pointer
// effects only bind on fine pointers (no jitter on touch).
const noMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(pointer: fine)').matches;

if (!noMotion) {
  // scroll progress thread (rAF-throttled; CSS reads --scroll)
  const bar = document.querySelector('.scroll-progress');
  if (bar) {
    let ticking = false;
    const paint = () => {
      const max = document.documentElement.scrollHeight - innerHeight;
      bar.style.setProperty('--scroll', max > 0 ? Math.min(1, scrollY / max) : 0);
      ticking = false;
    };
    addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(paint); } }, { passive: true });
    paint();
  }
}

if (!noMotion && finePointer) {
  // app cards: gentle 3D tilt toward the pointer
  grid.addEventListener('pointermove', (e) => {
    const card = e.target.closest('.app-card');
    if (!card) return;
    const r = card.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - .5;   // -0.5 … 0.5
    const py = (e.clientY - r.top) / r.height - .5;
    card.style.setProperty('--ry', (px * 7).toFixed(2) + 'deg');
    card.style.setProperty('--rx', (py * -7).toFixed(2) + 'deg');
  });
  grid.addEventListener('pointerout', (e) => {
    const card = e.target.closest('.app-card');
    if (card && !card.contains(e.relatedTarget)) {
      card.style.setProperty('--rx', '0deg');
      card.style.setProperty('--ry', '0deg');
    }
  });
}

// The shared fleet footer (root variant) — same look/feel as every app's
// footer, keeps the sharp Pole·cat wordmark, drops the old "What's new" link.
siteFooter('#siteFooter', {
  links: [
    { href: '#apps', label: 'Apps' },
    { href: '#work', label: 'Consulting' },
    { href: '#connect', label: 'Connect' },
    { href: 'https://www.linkedin.com/in/kevinrhaas/', label: 'LinkedIn', ext: true },
  ],
  root: true,
  meta: '© 2026 Polecat.live · GPL-3.0 · a collective of one, made with joy',
});
