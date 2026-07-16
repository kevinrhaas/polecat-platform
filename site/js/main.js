// main.js — renders the launcher grid from the vendored fleet catalog, then
// layers live status (latest version + ship time) from each app's changelog.
// The static render never waits on the network: offline, every card still
// works as a plain link.

import { publicFleet } from '../vendor/polecat-shell/catalog.js';
import { icon } from '../vendor/polecat-shell/icons.js';
import { relTime } from '../vendor/polecat-shell/ui.js';
import { appStatus } from './ingest.js';
import { initAuthUi } from './auth-ui.js';

const grid = document.getElementById('appsGrid');

function card(app){
  const a = document.createElement('a');
  a.className = 'app-card reveal';
  a.href = app.url;
  a.style.setProperty('--c', app.accent);
  a.innerHTML = `
    <div class="app-top">
      <div class="app-glyph">${icon(app.icon, 24)}</div>
      <div>
        <div class="app-name">${app.name}</div>
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

const apps = publicFleet();
const els = apps.map(card);
grid.replaceChildren(...els);
grid.setAttribute('aria-busy', 'false');

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

// "What's new" in the footer just links to the newest entry's app for now —
// the launcher's own changelog ships alongside (js/changelog.js).
document.getElementById('whatsNewLink').addEventListener('click', async (e) => {
  e.preventDefault();
  const { CHANGELOG } = await import('./changelog.js');
  const latest = CHANGELOG[0];
  alert(`polecat.live v${latest.v} — ${latest.title}\n\n• ${latest.items.join('\n• ')}`);
});
