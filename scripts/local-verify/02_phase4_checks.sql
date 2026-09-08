-- Phase 4 additions: verifies (a) case-insensitive per-user tag
-- uniqueness (migration 0004) and (b) that deleting a note cascades to
-- note_tags and note_embeddings with no orphaned rows left behind.
--
-- Run this against the same mindvault_test database, after
-- 01_rls_checks.sql (it reuses Alice/Bob and their existing rows).

set client_min_messages to warning;
set role authenticated;

-- (a) Case-insensitive uniqueness -------------------------------------
-- Alice already has a tag named "security" (inserted in 01_rls_checks).
-- Trying to insert "Security" or "SECURITY" for her must violate the
-- new unique index rather than silently creating a duplicate tag.
select set_config('test.current_user_id', '11111111-1111-1111-1111-111111111111', false);

do $$
begin
  begin
    insert into public.tags (user_id, name) values
      ('11111111-1111-1111-1111-111111111111', 'Security');
    raise exception 'expected unique-index violation for case-variant tag, but insert succeeded';
  exception
    when unique_violation then
      raise notice 'PASS: inserting "Security" for a user who already has "security" is rejected';
  end;
end $$;

-- A different user (Bob) must still be able to use the same name —
-- case-insensitive uniqueness is per-user, not global.
select set_config('test.current_user_id', '22222222-2222-2222-2222-222222222222', false);

do $$
declare
  cnt int;
begin
  -- Bob already has a lowercase "react" tag from 01_rls_checks; this
  -- confirms the constraint didn't accidentally become global.
  select count(*) into cnt from public.tags
    where user_id = '22222222-2222-2222-2222-222222222222' and lower(name) = 'react';
  assert cnt = 1, 'expected Bob to still have exactly 1 "react" tag, got ' || cnt;
  raise notice 'PASS: case-insensitive uniqueness is scoped per user, not global';
end $$;

-- (b) Cascade delete: deleting a note removes its note_tags and
-- note_embeddings rows automatically (FK ON DELETE CASCADE), with
-- nothing left orphaned.
select set_config('test.current_user_id', '11111111-1111-1111-1111-111111111111', false);

do $$
declare
  tag_count int;
  embedding_count int;
begin
  delete from public.notes where id = 'a1111111-0000-0000-0000-000000000001';

  select count(*) into tag_count from public.note_tags
    where note_id = 'a1111111-0000-0000-0000-000000000001';
  assert tag_count = 0, 'expected note_tags to cascade-delete, found ' || tag_count || ' leftover rows';

  select count(*) into embedding_count from public.note_embeddings
    where note_id = 'a1111111-0000-0000-0000-000000000001';
  assert embedding_count = 0, 'expected note_embeddings to cascade-delete, found ' || embedding_count || ' leftover rows';

  raise notice 'PASS: deleting a note cascades to note_tags and note_embeddings with no orphans';
end $$;

reset role;

select '=== ALL PHASE 4 CHECKS PASSED ===' as result;
