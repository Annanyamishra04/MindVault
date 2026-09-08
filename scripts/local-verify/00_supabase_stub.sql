-- Minimal stand-in for the parts of Supabase's built-in `auth` schema
-- that our migrations depend on: the auth.users table, the roles
-- PostgREST/Supabase assigns (anon, authenticated, service_role), and
-- the auth.uid() helper function RLS policies call. This is NOT part
-- of the app's migrations — it exists only so we can dry-run the real
-- migration files against a plain local Postgres instance.

create schema if not exists auth;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Real Supabase implements auth.uid() by reading a JWT claim out of
-- request.jwt.claims (set per-request by PostgREST). We approximate
-- that here with a session-local setting we can flip with `set_config`
-- to simulate "logged in as user X" for each test block below.
create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(current_setting('test.current_user_id', true), '')::uuid
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to anon, authenticated, service_role;
