-- Real Supabase projects automatically grant broad table privileges to
-- `authenticated` (and `service_role`) at the platform level — this is
-- NOT something project migrations do, Supabase does it for every
-- project out of the box. We replicate it here only so the local test
-- harness behaves like a real project; RLS (not these grants) is what
-- actually restricts access.

grant all on all tables in schema public to authenticated, service_role;
grant all on all sequences in schema public to authenticated, service_role;
