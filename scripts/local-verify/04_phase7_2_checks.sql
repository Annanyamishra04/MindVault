-- Phase 7.2 additions: verifies migration 0008's fix for the remaining
-- write-order race (content_version + commit_note_embedding() +
-- confirm_note_embedding_ready()).
--
-- Run this against the same mindvault_test database, after
-- 0008_phase7_2_atomic_embedding_commit.sql (and, transitively, after
-- 0006/0007 for note_embeddings/embedding_status to exist). Reuses
-- Alice and Bob.
--
-- IMPORTANT: unlike the other 0N_*_checks.sql files, this one is NOT a
-- single psql script you can just -f in. Part (a) below requires two
-- genuinely concurrent database sessions to demonstrate that the
-- SELECT ... FOR UPDATE lock inside commit_note_embedding() actually
-- serializes against a concurrent note save, which a single psql
-- session cannot exercise on its own. See
-- scripts/local-verify/README.md for how to run part (a). Parts (b)
-- and (c) below are ordinary single-session assertions and can be run
-- with `psql -f` like the other check files, provided part (a) has
-- already created and left the note in the state it describes.

set client_min_messages to warning;
set role authenticated;

-- (a) THE ACTUAL RACE, WITH REAL CONCURRENCY -----------------------------
--
-- This part is illustrative documentation of a manual test, not
-- something this single file executes (see the note above). It was run
-- as follows against this database:
--
--   1. Insert a fresh note for Alice, e.g.:
--        insert into public.notes (id, user_id, title, content) values
--          ('a1111111-0000-0000-0000-000000000003', '<alice>',
--           'Race test note', 'Version 1 content');
--      -- content_version = 1, embedding_status = 'pending'
--
--   2. In one session ("A", simulating an in-flight embedding commit for
--      version 1), run inside an explicit transaction, with a
--      pg_sleep(3) between the lock and the write to widen the window
--      artificially so a concurrent session has time to attempt a
--      conflicting write while A is "in flight":
--        begin;
--        select content_version from public.notes
--          where id = '...' and user_id = '<alice>' for update;
--        select pg_sleep(3);
--        insert into public.note_embeddings (...) values (...)
--          on conflict (note_id) do update set ...;
--        update public.notes set embedding_status = 'ready'
--          where id = '...' and content_version = 1;
--        commit;
--
--   3. Concurrently (started ~1s after step 2, i.e. while A is still
--      sleeping and holding the row lock), in a second session ("B",
--      simulating a real user edit landing while the embedding job is
--      running):
--        update public.notes set title = '...', content = 'Version 2 content'
--          where id = '...';
--
-- Observed, measured result (see the Phase 7.2 final report for the
-- actual timing captured): B's UPDATE blocked for ~2.3 seconds — until
-- A committed — which is the row lock actually doing its job, not
-- assumed. Once B's UPDATE proceeded, the note read back as
-- content_version = 2, embedding_status = 'stale': the
-- bump_note_content_version trigger fired as part of B's single
-- UPDATE statement, correctly flipping the 'ready' status A had just
-- committed back to 'stale' for the version A never actually embedded.
-- This is the exact "newer content + older embedding + ready" failure
-- mode from the Phase 7.2 report, and it did not occur: at no point
-- was content_version = 2 paired with embedding_status = 'ready' and a
-- version-1 embedding.

-- (b) commit_note_embedding IS THE ATOMIC FIX ----------------------------
--
-- Continuing from the state left by (a) — note is at content_version =
-- 2, embedding_status = 'stale', note_embeddings still holds A's
-- version-1 vector (content_hash = 'hash-for-version-1').

select set_config('test.current_user_id', '11111111-1111-1111-1111-111111111111', false);

-- A stale commit (expected_version = 1, but the note has already moved
-- to version 2) must be rejected outright: no vector write, no status
-- change. This is the specific database-boundary check that an
-- application-level pre-write check cannot substitute for.
do $$
declare
  result boolean;
  v_status text;
  v_hash text;
begin
  select public.commit_note_embedding(
    'a1111111-0000-0000-0000-000000000003'::uuid, 1, 'hash-for-stale-v1-retry',
    array_fill(0.9, array[768])::vector, 'gemini-embedding-2', 768
  ) into result;
  assert result = false, 'expected a stale commit to be rejected, got ' || result;

  select embedding_status into v_status from public.notes
    where id = 'a1111111-0000-0000-0000-000000000003';
  assert v_status = 'stale', 'a rejected commit must not touch embedding_status, got ' || v_status;

  select content_hash into v_hash from public.note_embeddings
    where note_id = 'a1111111-0000-0000-0000-000000000003';
  assert v_hash = 'hash-for-version-1', 'a rejected commit must not touch note_embeddings, got hash ' || v_hash;

  raise notice 'PASS: commit_note_embedding rejects a stale expected_version without touching any row';
end $$;

-- A commit for the CURRENT version (2) must succeed and atomically
-- write both the vector and 'ready'.
do $$
declare
  result boolean;
  v_status text;
  v_hash text;
begin
  select public.commit_note_embedding(
    'a1111111-0000-0000-0000-000000000003'::uuid, 2, 'hash-for-version-2',
    array_fill(0.2, array[768])::vector, 'gemini-embedding-2', 768
  ) into result;
  assert result = true, 'expected a current-version commit to succeed, got ' || result;

  select embedding_status into v_status from public.notes
    where id = 'a1111111-0000-0000-0000-000000000003';
  assert v_status = 'ready', 'expected embedding_status = ready after a successful commit, got ' || v_status;

  select content_hash into v_hash from public.note_embeddings
    where note_id = 'a1111111-0000-0000-0000-000000000003';
  assert v_hash = 'hash-for-version-2', 'expected the new vector to be written, got hash ' || v_hash;

  raise notice 'PASS: commit_note_embedding writes the vector and marks ready atomically for a matching version';
end $$;

-- confirm_note_embedding_ready: succeeds for the still-current version...
do $$
declare result boolean;
begin
  select public.confirm_note_embedding_ready('a1111111-0000-0000-0000-000000000003'::uuid, 2) into result;
  assert result = true, 'expected confirmReady to succeed for the current version, got ' || result;
  raise notice 'PASS: confirm_note_embedding_ready confirms ready for the current version';
end $$;

-- ...and a real edit landing afterward must both bump content_version
-- and flip 'ready' back to 'stale' as part of the SAME statement (the
-- trigger, not a second app-level write).
do $$
declare
  v_version int;
  v_status text;
begin
  update public.notes set title = 'Race test note (edited again)', content = 'Version 3 content'
    where id = 'a1111111-0000-0000-0000-000000000003';

  select content_version, embedding_status into v_version, v_status
    from public.notes where id = 'a1111111-0000-0000-0000-000000000003';
  assert v_version = 3, 'expected content_version to bump to 3, got ' || v_version;
  assert v_status = 'stale', 'expected embedding_status to flip to stale in the same statement, got ' || v_status;
  raise notice 'PASS: bump_note_content_version trigger bumps the version and invalidates ready atomically on edit';
end $$;

-- ...and confirm_note_embedding_ready for the now-stale version (2)
-- must be rejected, leaving 'stale' untouched.
do $$
declare
  result boolean;
  v_status text;
begin
  select public.confirm_note_embedding_ready('a1111111-0000-0000-0000-000000000003'::uuid, 2) into result;
  assert result = false, 'expected confirmReady to reject a stale version, got ' || result;

  select embedding_status into v_status from public.notes
    where id = 'a1111111-0000-0000-0000-000000000003';
  assert v_status = 'stale', 'a rejected confirmReady must not flip status to ready, got ' || v_status;

  raise notice 'PASS: confirm_note_embedding_ready rejects a stale version and leaves embedding_status untouched';
end $$;

-- (c) CROSS-USER PROTECTION (RLS) ----------------------------------------
--
-- Bob must not be able to write, or even move the status of, Alice's
-- note through either function — same standard as every other RPC in
-- this project (search_note_ids, get_or_create_tag,
-- create_note_with_tags).

select set_config('test.current_user_id', '22222222-2222-2222-2222-222222222222', false);

do $$
declare
  commit_result boolean;
  confirm_result boolean;
begin
  select public.commit_note_embedding(
    'a1111111-0000-0000-0000-000000000003'::uuid, 3, 'bob-injected-hash',
    array_fill(0.5, array[768])::vector, 'gemini-embedding-2', 768
  ) into commit_result;
  assert commit_result = false, 'Bob must not be able to commit an embedding for Alice''s note, got ' || commit_result;

  select public.confirm_note_embedding_ready('a1111111-0000-0000-0000-000000000003'::uuid, 3) into confirm_result;
  assert confirm_result = false, 'Bob must not be able to confirm-ready Alice''s note, got ' || confirm_result;

  raise notice 'PASS: Bob''s cross-user commit/confirm attempts are both rejected by RLS';
end $$;

select set_config('test.current_user_id', '11111111-1111-1111-1111-111111111111', false);

do $$
declare
  v_status text;
  v_hash text;
begin
  select embedding_status into v_status from public.notes
    where id = 'a1111111-0000-0000-0000-000000000003';
  select content_hash into v_hash from public.note_embeddings
    where note_id = 'a1111111-0000-0000-0000-000000000003';

  assert v_status = 'stale', 'Bob''s rejected attempts must not have changed Alice''s embedding_status, got ' || v_status;
  assert v_hash = 'hash-for-version-2', 'Bob''s rejected attempts must not have changed Alice''s stored vector, got hash ' || v_hash;

  raise notice 'PASS: Alice''s note/embedding are unchanged after Bob''s rejected cross-user attempts';
end $$;

reset role;

select '=== ALL PHASE 7.2 CHECKS PASSED ===' as result;
