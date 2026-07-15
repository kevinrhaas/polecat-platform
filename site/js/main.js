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
  if(!s || !s.v) return; // offline / unreachable → static card stands
  const row = el.querySelector('[data-status]');
  row.innerHTML = `
    <span class="app-dot"></span>
    <span>v${s.v}${s.ts ? ` · shipped ${relTime(s.ts)}` : ''}</span>`;
}

const apps = publicFleet();
const els = apps.map(card);
grid.replaceChildren(...els);
grid.setAttribute('aria-busy', 'false');
apps.forEach((app, i) => { if(app.status === 'live') hydrate(app, els[i]); });

// scroll reveal (matches the original polecat site behavior)
const io = new IntersectionObserver((entries) => {
  for(const e of entries) if(e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target); }
}, { threshold: .08 });
document.querySelectorAll('.reveal').forEach(el => io.observe(el));

initAuthUi(document.getElementById('signInBtn'));

// "What's new" in the footer just links to the newest entry's app for now —
// the launcher's own changelog ships alongside (js/changelog.js).
document.getElementById('whatsNewLink').addEventListener('click', async (e) => {
  e.preventDefault();
  const { CHANGELOG } = await import('./changelog.js');
  const latest = CHANGELOG[0];
  alert(`polecat.live v${latest.v} — ${latest.title}\n\n• ${latest.items.join('\n• ')}`);
});
