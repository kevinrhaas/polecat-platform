// auth-ui.js — the launcher's sign-in surface, wired to the auth adapter
// seam. Today the null adapter is active (logged-out-first: everything on
// polecat.live works without an account), so the button opens an honest
// "what accounts will add" panel instead of a dead login form. When the
// Supabase phase lands, initAuthUi grows the real provider buttons and an
// account menu — same seam, no rework here.

import '../vendor/polecat-shell/auth/null.js';
import { activeAuth } from '../vendor/polecat-shell/auth/schema.js';
import { modal, el } from '../vendor/polecat-shell/ui.js';

export function initAuthUi(btn){
  if(!btn) return;
  btn.addEventListener('click', async () => {
    const auth = activeAuth();
    const user = await auth.getUser();
    if(user){ /* account menu arrives with the Supabase phase */ return; }
    // modal() body takes NODES (strings render as literal text), so build DOM.
    modal({
      title: 'Accounts are coming soon',
      body: el('div', {}, [
        el('p', { style: 'margin-bottom:10px', html:
          'Everything on Polecat works <b>without</b> an account — your data lives in this browser.' }),
        el('p', { style: 'margin-bottom:10px', html:
          'Signing in (Google, Apple, or email) will add: one profile across every app, synced workspaces, and sharing.' }),
        el('p', { style: 'font-size:13px', html:
          'Self-hosters: the suite is GPL-3 and the backend seam is open — you can point any app at your own backend.' }),
      ]),
    });
  });
}
