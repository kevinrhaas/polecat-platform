// connect.js — the "Connect with us" form on polecat.live.
//
// Submits to a Supabase `connect_requests` table (config in connect-config.js)
// when configured; otherwise — or if the request fails — falls back to opening
// a pre-filled email to contactEmail, so the form is never a dead end. Reads
// window.POLECAT_CONNECT lazily at submit time (config script loads first).

function cfg(){ return window.POLECAT_CONNECT || {}; }

async function toSupabase(rec){
  const { supabaseUrl, anonKey } = cfg();
  if(!supabaseUrl || !anonKey) return false;
  const res = await fetch(supabaseUrl.replace(/\/$/, '') + '/rest/v1/connect_requests', {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: 'Bearer ' + anonKey,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(rec),
  });
  return res.ok;
}

function mailtoFallback(rec){
  const to = cfg().contactEmail || 'kevin.haas@polecat.live';
  const subject = encodeURIComponent('Polecat — ' + (rec.topic || 'hello'));
  const body = encodeURIComponent(
    `Name: ${rec.name}\nEmail: ${rec.email}\nInterested in: ${rec.topic}\n\n${rec.message || ''}`,
  );
  window.location.href = `mailto:${to}?subject=${subject}&body=${body}`;
  return to;
}

function thankYou(form, msg){
  const card = document.createElement('div');
  card.className = 'connect-thanks';
  card.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>' +
    '<p></p>';
  card.querySelector('p').textContent = msg;
  form.replaceWith(card);
}

export function initConnect(form){
  if(!form) return;
  const status = form.querySelector('.cf-status');
  const btn = form.querySelector('button[type="submit"]');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(form).entries());
    if(!d.name || !d.email){ if(status) status.textContent = 'Please add your name and email.'; return; }
    if(btn) btn.disabled = true;
    if(status) status.textContent = 'Sending…';
    const rec = { name: d.name.trim(), email: d.email.trim(), topic: d.topic || '', message: (d.message || '').trim(), source: 'polecat.live' };
    let stored = false;
    try { stored = await toSupabase(rec); } catch { stored = false; }
    if(stored){ thankYou(form, "Thanks — we've got it, and we'll be in touch soon."); return; }
    const to = mailtoFallback(rec);
    thankYou(form, `Opening your email app to reach ${to}. If nothing happens, write us there directly.`);
  });
}
