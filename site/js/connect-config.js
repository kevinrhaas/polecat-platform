// connect-config.js — backend config for the "Connect with us" form.
//
// Safe to commit: a Supabase anon (public) key is designed to live in client
// code and is protected by row-level security — the RLS policy in
// provisioning/supabase/connect_requests.sql grants anon INSERT only, so the
// site can submit but never read or edit other people's messages. Manage
// submissions from the Supabase dashboard (service role).
//
// To go live: create a Supabase project, run the SQL, and paste the project
// URL + anon key below. Until then the form gracefully falls back to opening
// a pre-filled email to contactEmail.
//
// Loaded as a classic script (sets a global) BEFORE the deferred main.js
// module, so connect.js sees it at submit time.
window.POLECAT_CONNECT = {
  supabaseUrl: '',                          // e.g. https://abcd1234.supabase.co
  anonKey: '',                              // Supabase anon / public key
  contactEmail: 'kevin.haas@polecat.live',  // email fallback + where replies go
};
