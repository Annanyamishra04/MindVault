-- Phase 4.1 additions: verifies the three RPCs added in migration 0005
-- (search_note_ids, get_or_create_tag, create_note_with_tags) — filter
-- safety, RLS scoping, tag-uniqueness/race handling, and note+tag
-- atomicity.
--
-- Run this against the same mindvault_test database, after
-- 02_phase4_checks.sql (it reuses Alice/Bob and their existing rows;
-- note Alice's original note was deleted by 02_phase4_checks.sql's
-- cascade test, but her "security" tag survives that, which this file
-- relies on for the get_or_create_tag checks below).

set client_min_messages to warning;
set role authenticated;

-- (a) search_note_ids: basic matching + RLS scoping ---------------------

select set_config('test.current_user_id', '22222222-2222-2222-2222-222222222222', false);

insert into public.notes (id, user_id, title, content) values
  ('b1111111-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'Bob note 2', 'Postgres row level security is enforced per statement.');

do $$
declare cnt int;
begin
  select count(*) into cnt from public.search_note_ids('%React%')
    where note_id = 'b1111111-0000-0000-0000-000000000001';
  assert cnt = 1, 'expected search_note_ids to find Bob''s React note, got ' || cnt;
  raise notice 'PASS: search_note_ids matches title/content for the caller';
end $$;

-- A pattern that would match content on ANOTHER user's note must not
-- return that note, even though search_note_ids is a SECURITY INVOKER
-- function the caller can invoke directly with arbitrary arguments —
-- the explicit `n.user_id = auth.uid()` filter (defense in depth on
-- top of notes' own RLS policy) must hold regardless.
select set_config('test.current_user_id', '11111111-1111-1111-1111-111111111111', false);

insert into public.notes (id, user_id, title, content) values
  ('a1111111-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'Alice note 2', 'The onboarding checklist lives in this note.');

select set_config('test.current_user_id', '22222222-2222-2222-2222-222222222222', false);

do $$
declare cnt int;
begin
  select count(*) into cnt from public.search_note_ids('%onboarding%');
  assert cnt = 0, 'Bob should not be able to search up Alice''s note via search_note_ids, got ' || cnt;
  raise notice 'PASS: search_note_ids is scoped to the caller, not just the pattern';
end $$;

-- A pattern containing PostgREST filter-grammar metacharacters
-- (comma, parens, dots) must be treated as inert literal text, not
-- cause an error or match unrelated rows — demonstrating there's no
-- filter-grammar left for it to break out of, since it's a bound RPC
-- argument rather than text spliced into a filter string.
do $$
declare cnt int;
begin
  select count(*) into cnt from public.search_note_ids('%,id.neq.00000000-0000-0000-0000-000000000000)(%');
  assert cnt = 0, 'metacharacter-laden pattern should just match nothing, got ' || cnt;
  raise notice 'PASS: filter-grammar metacharacters in the search pattern are inert';
end $$;

-- (b) get_or_create_tag: case-insensitive reuse + no duplicate rows -----

select set_config('test.current_user_id', '11111111-1111-1111-1111-111111111111', false);

do $$
declare
  returned_id uuid;
  existing_id uuid := 'a2222222-0000-0000-0000-000000000001'; -- Alice's "security" tag
  tag_count int;
begin
  select id into returned_id from public.get_or_create_tag('Security');
  assert returned_id = existing_id,
    'expected get_or_create_tag("Security") to return the existing "security" tag id, got ' || returned_id;

  select count(*) into tag_count from public.tags
    where user_id = '11111111-1111-1111-1111-111111111111' and lower(name) = 'security';
  assert tag_count = 1, 'expected exactly 1 "security"-family tag for Alice, got ' || tag_count;

  raise notice 'PASS: get_or_create_tag reuses an existing tag case-insensitively without duplicating it';
end $$;

do $$
declare
  first_id uuid;
  second_id uuid;
begin
  select id into first_id from public.get_or_create_tag('Kubernetes');
  select id into second_id from public.get_or_create_tag('kubernetes');
  assert first_id = second_id,
    'expected two get_or_create_tag calls differing only by case to return the same id';
  raise notice 'PASS: get_or_create_tag is idempotent across case variants for new tags too';
end $$;

-- (c) create_note_with_tags: atomic creation, dedup, and isolation ------

select set_config('test.current_user_id', '22222222-2222-2222-2222-222222222222', false);

do $$
declare
  new_note_id uuid;
  linked_tag_count int;
  distinct_tag_count int;
begin
  select public.create_note_with_tags(
    'Atomic note', 'Created via create_note_with_tags', false,
    array['Go', 'go', 'GO', 'infra']
  ) into new_note_id;

  assert new_note_id is not null, 'expected create_note_with_tags to return a note id';

  select count(*) into linked_tag_count from public.note_tags where note_id = new_note_id;
  assert linked_tag_count = 2,
    'expected exactly 2 note_tags rows (Go/go/GO deduped to one tag, plus infra), got ' || linked_tag_count;

  select count(distinct lower(t.name)) into distinct_tag_count
    from public.note_tags nt join public.tags t on t.id = nt.tag_id
    where nt.note_id = new_note_id;
  assert distinct_tag_count = 2, 'expected 2 distinct tag names attached, got ' || distinct_tag_count;

  raise notice 'PASS: create_note_with_tags creates the note and attaches deduplicated tags atomically';
end $$;

-- The guard clause (no auth.uid()) must reject the call before doing
-- any writes at all — proving the function doesn't leave partial state
-- behind even in the simplest failure case. Full "note inserted, then
-- a later statement in the same call fails" rollback is guaranteed by
-- Postgres's standard behavior for functions (all statements in a
-- single function invocation run in the caller's transaction; an
-- uncaught exception aborts that transaction), rather than re-proven
-- here with a contrived failure injection.
select set_config('test.current_user_id', '', false);

do $$
declare
  notes_before int;
  notes_after int;
  threw boolean := false;
begin
  select count(*) into notes_before from public.notes;
  begin
    perform public.create_note_with_tags('Should not exist', '', false, array[]::text[]);
  exception when others then
    threw := true;
  end;
  assert threw, 'expected create_note_with_tags to raise when auth.uid() is null';

  select count(*) into notes_after from public.notes;
  assert notes_after = notes_before,
    'expected no note to be created, had ' || notes_before || ' before and ' || notes_after || ' after';

  raise notice 'PASS: create_note_with_tags rejects unauthenticated calls without partial writes';
end $$;

reset role;

select '=== ALL PHASE 4.1 CHECKS PASSED ===' as result;
