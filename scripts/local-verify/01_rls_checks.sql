-- Empirically verifies Row Level Security by creating two separate
-- users, giving each their own notes/tags/embeddings, then switching
-- the simulated auth.uid() between them and confirming each only ever
-- sees their own rows. Every check below should print "PASS".

set client_min_messages to warning;

-- Two users signing up (fires handle_new_user() automatically).
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');

-- Sanity check: the signup trigger created matching profiles.
do $$
declare
  cnt int;
begin
  select count(*) into cnt from public.profiles
    where id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');
  assert cnt = 2, 'expected handle_new_user() to create 2 profiles, got ' || cnt;
  raise notice 'PASS: signup trigger created profiles for both users';
end $$;

-- Email-sync trigger check.
update auth.users set email = 'alice-new@example.com'
  where id = '11111111-1111-1111-1111-111111111111';

do $$
declare
  synced_email text;
begin
  select email into synced_email from public.profiles
    where id = '11111111-1111-1111-1111-111111111111';
  assert synced_email = 'alice-new@example.com', 'expected profiles.email to sync, got ' || synced_email;
  raise notice 'PASS: profiles.email stayed in sync after auth.users email change';
end $$;

-- Everything below runs AS the two application roles (authenticated),
-- with auth.uid() simulated via test.current_user_id, exactly like
-- policies would see it in production via the JWT.

set role authenticated;
select set_config('test.current_user_id', '11111111-1111-1111-1111-111111111111', false);

insert into public.notes (id, user_id, title, content) values
  ('a1111111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Alice note 1', 'JWT tokens expire after 15 minutes.');
insert into public.tags (id, user_id, name) values
  ('a2222222-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'security');
insert into public.note_tags (note_id, tag_id) values
  ('a1111111-0000-0000-0000-000000000001', 'a2222222-0000-0000-0000-000000000001');
insert into public.note_embeddings (note_id, user_id, embedding) values
  ('a1111111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', array_fill(0.01, array[768])::vector);

select set_config('test.current_user_id', '22222222-2222-2222-2222-222222222222', false);

insert into public.notes (id, user_id, title, content) values
  ('b1111111-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Bob note 1', 'React Server Components run on the server.');
insert into public.tags (id, user_id, name) values
  ('b2222222-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'react');
insert into public.note_tags (note_id, tag_id) values
  ('b1111111-0000-0000-0000-000000000001', 'b2222222-0000-0000-0000-000000000001');
insert into public.note_embeddings (note_id, user_id, embedding) values
  ('b1111111-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', array_fill(0.02, array[768])::vector);

-- --- Now act as Bob and try to see/touch Alice's data. ---
select set_config('test.current_user_id', '22222222-2222-2222-2222-222222222222', false);

do $$
declare cnt int;
begin
  select count(*) into cnt from public.notes where id = 'a1111111-0000-0000-0000-000000000001';
  assert cnt = 0, 'Bob should not see Alice''s note via SELECT, saw ' || cnt;
  raise notice 'PASS: Bob cannot SELECT Alice''s note';
end $$;

do $$
declare cnt int;
begin
  select count(*) into cnt from public.tags where id = 'a2222222-0000-0000-0000-000000000001';
  assert cnt = 0, 'Bob should not see Alice''s tag, saw ' || cnt;
  raise notice 'PASS: Bob cannot SELECT Alice''s tag';
end $$;

do $$
declare cnt int;
begin
  select count(*) into cnt from public.note_tags where note_id = 'a1111111-0000-0000-0000-000000000001';
  assert cnt = 0, 'Bob should not see Alice''s note_tags row, saw ' || cnt;
  raise notice 'PASS: Bob cannot SELECT Alice''s note_tags row';
end $$;

do $$
declare cnt int;
begin
  select count(*) into cnt from public.note_embeddings where note_id = 'a1111111-0000-0000-0000-000000000001';
  assert cnt = 0, 'Bob should not see Alice''s embedding, saw ' || cnt;
  raise notice 'PASS: Bob cannot SELECT Alice''s embedding';
end $$;

do $$
declare cnt int;
begin
  select count(*) into cnt from public.profiles where id = '11111111-1111-1111-1111-111111111111';
  assert cnt = 0, 'Bob should not see Alice''s profile, saw ' || cnt;
  raise notice 'PASS: Bob cannot SELECT Alice''s profile';
end $$;

-- Bob tries to UPDATE Alice's note (should silently affect 0 rows, not error).
do $$
declare affected int;
begin
  update public.notes set title = 'hacked' where id = 'a1111111-0000-0000-0000-000000000001';
  get diagnostics affected = row_count;
  assert affected = 0, 'Bob should not be able to UPDATE Alice''s note, affected ' || affected;
  raise notice 'PASS: Bob cannot UPDATE Alice''s note';
end $$;

-- Bob tries to DELETE Alice's note.
do $$
declare affected int;
begin
  delete from public.notes where id = 'a1111111-0000-0000-0000-000000000001';
  get diagnostics affected = row_count;
  assert affected = 0, 'Bob should not be able to DELETE Alice''s note, affected ' || affected;
  raise notice 'PASS: Bob cannot DELETE Alice''s note';
end $$;

-- Bob tries to plant a bogus embedding row on Alice's note (the gap we
-- specifically patched in the RLS policies this phase).
do $$
declare threw boolean := false;
begin
  begin
    insert into public.note_embeddings (note_id, user_id, embedding)
    values ('a1111111-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', array_fill(0.03, array[768])::vector);
  exception when others then
    threw := true;
  end;
  assert threw, 'Bob should NOT be able to insert an embedding row against Alice''s note';
  raise notice 'PASS: Bob cannot insert an embedding row pointing at Alice''s note';
end $$;

-- Bob tries to tag Alice's note using his own tag.
do $$
declare threw boolean := false;
begin
  begin
    insert into public.note_tags (note_id, tag_id)
    values ('a1111111-0000-0000-0000-000000000001', 'b2222222-0000-0000-0000-000000000001');
  exception when others then
    threw := true;
  end;
  assert threw, 'Bob should NOT be able to tag Alice''s note';
  raise notice 'PASS: Bob cannot tag Alice''s note';
end $$;

-- match_notes / match_related_notes must never cross the user boundary,
-- even though Bob supplies his own vector and a plausible match_user_id.
do $$
declare cnt int;
begin
  select count(*) into cnt from public.match_notes(
    array_fill(0.01, array[768])::vector, -- deliberately close to Alice's vector
    '22222222-2222-2222-2222-222222222222',
    10, 0.0
  ) where note_id = 'a1111111-0000-0000-0000-000000000001';
  assert cnt = 0, 'match_notes leaked Alice''s note to Bob';
  raise notice 'PASS: match_notes does not leak across users';
end $$;

-- Bob switching back to see his OWN data still works normally.
do $$
declare cnt int;
begin
  select count(*) into cnt from public.notes where id = 'b1111111-0000-0000-0000-000000000001';
  assert cnt = 1, 'Bob should still see his own note, saw ' || cnt;
  raise notice 'PASS: Bob can still see his own note';
end $$;

reset role;

do $$
begin
  raise notice '=== ALL RLS CHECKS PASSED ===';
end $$;
