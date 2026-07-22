-- connect_requests — backs the "Connect with us" form on polecat.live.
--
-- Run this once in your Supabase project's SQL editor. Then paste the project
-- URL + anon key into site/js/connect-config.js. Submissions are write-only
-- from the public site (anon INSERT); read/manage them from the Supabase
-- dashboard (service role) or an authenticated admin — the anon key on the
-- site can never read them back.
--
-- The anon/public key is safe in client code precisely because of the RLS
-- policy below: without a permissive SELECT/UPDATE/DELETE policy for `anon`,
-- the key grants nothing but the single INSERT we allow here.

create table if not exists public.connect_requests (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name       text not null,
  email      text not null,
  topic      text,
  message    text,
  source     text,                 -- which surface sent it (e.g. 'polecat.live')
  handled    boolean not null default false
);

alter table public.connect_requests enable row level security;

-- Anonymous visitors may submit (INSERT) only. No SELECT/UPDATE/DELETE policy
-- for anon exists, so RLS denies those by default — the public key is inert
-- beyond creating a request.
drop policy if exists "anon can submit connect requests" on public.connect_requests;
create policy "anon can submit connect requests"
  on public.connect_requests
  for insert
  to anon
  with check (true);
