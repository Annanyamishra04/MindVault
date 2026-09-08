#!/usr/bin/env bash
# Phase 7.2: real two-session concurrency test.
#
# A single psql script can't demonstrate that commit_note_embedding()'s
# SELECT ... FOR UPDATE actually blocks a concurrent writer — that
# requires two genuinely concurrent sessions. This script runs both:
#
#   Session A: simulates an in-flight embedding commit for version 1.
#              It holds the row lock and sleeps for 3s before writing,
#              to widen the window artificially so session B has time
#              to attempt a conflicting write while A is "in flight".
#   Session B: simulates a real user edit landing ~1s into A's sleep —
#              i.e. while the old race would have had A and B's writes
#              both in-flight with neither having committed yet.
#
# Expected, and asserted, result: B's UPDATE blocks until A commits
# (proving the lock is real, not just assumed), and once B proceeds the
# note reads back as content_version = 2, embedding_status = 'stale' —
# the bump_note_content_version trigger correctly invalidating the
# 'ready' status A just committed for content A never actually
# embedded. This leaves the database in the state
# 04_phase7_2_checks.sql's part (b) assumes.
#
# Usage: run after 0008_phase7_2_atomic_embedding_commit.sql has been
# applied to mindvault_test, and after inserting the Alice test note
# (see below). Must run as the `postgres` OS user, e.g.:
#   sudo -u postgres bash scripts/local-verify/04b_phase7_2_concurrency_test.sh

set -euo pipefail

NOTE_ID="a1111111-0000-0000-0000-000000000003"
ALICE_ID="11111111-1111-1111-1111-111111111111"
WORKDIR=$(mktemp -d)

psql -d mindvault_test -v ON_ERROR_STOP=1 <<SQL
set client_min_messages to warning;
set role authenticated;
select set_config('test.current_user_id', '${ALICE_ID}', false);
insert into public.notes (id, user_id, title, content) values
  ('${NOTE_ID}', '${ALICE_ID}', 'Race test note', 'Version 1 content')
on conflict (id) do nothing;
reset role;
SQL

cat > "$WORKDIR/session_a.sql" <<SQL
set client_min_messages to warning;
set role authenticated;
select set_config('test.current_user_id', '${ALICE_ID}', false);
begin;
select content_version from public.notes where id = '${NOTE_ID}' and user_id = '${ALICE_ID}' for update;
select pg_sleep(3);
insert into public.note_embeddings (note_id, user_id, embedding, content_hash, embedding_model, embedding_dimensions, note_content_version)
values ('${NOTE_ID}', '${ALICE_ID}', array_fill(0.1, array[768])::vector, 'hash-for-version-1', 'gemini-embedding-2', 768, 1)
on conflict (note_id) do update set
  embedding = excluded.embedding, content_hash = excluded.content_hash,
  embedding_model = excluded.embedding_model, embedding_dimensions = excluded.embedding_dimensions,
  note_content_version = excluded.note_content_version;
update public.notes set embedding_status = 'ready' where id = '${NOTE_ID}' and content_version = 1;
commit;
SQL

echo "Starting session A in the background (holds the row lock ~3s)..."
psql -d mindvault_test -v ON_ERROR_STOP=1 -f "$WORKDIR/session_a.sql" > "$WORKDIR/session_a.log" 2>&1 &
A_PID=$!

sleep 1
echo "Session B: attempting a concurrent content save (expected to BLOCK)..."
START=$(date +%s.%N)
psql -d mindvault_test -v ON_ERROR_STOP=1 <<SQL > "$WORKDIR/session_b.log" 2>&1
set client_min_messages to warning;
set role authenticated;
select set_config('test.current_user_id', '${ALICE_ID}', false);
update public.notes set title = 'Race test note (edited)', content = 'Version 2 content'
  where id = '${NOTE_ID}';
SQL
END=$(date +%s.%N)
ELAPSED=$(echo "$END - $START" | bc)

wait "$A_PID"

echo "--- session A log ---"; cat "$WORKDIR/session_a.log"
echo "--- session B log ---"; cat "$WORKDIR/session_b.log"
echo "session B's UPDATE took ${ELAPSED}s"

psql -d mindvault_test -v ON_ERROR_STOP=1 <<SQL
set client_min_messages to warning;
set role authenticated;
select set_config('test.current_user_id', '${ALICE_ID}', false);
do \$\$
declare
  v_version int;
  v_status text;
begin
  select content_version, embedding_status into v_version, v_status
    from public.notes where id = '${NOTE_ID}';
  assert v_version = 2, 'expected content_version 2 after session B''s edit, got ' || v_version;
  assert v_status = 'stale', 'expected embedding_status stale (session A''s ready must be invalidated), got ' || v_status;
  raise notice 'PASS: concurrent session B correctly blocked on, then invalidated, session A''s in-flight commit';
end \$\$;
reset role;
SQL

python3 -c "
elapsed = float('$ELAPSED')
assert elapsed > 1.5, f'expected session B to block for roughly the remainder of A\\'s 3s sleep, only waited {elapsed}s'
print(f'PASS: session B blocked for {elapsed:.2f}s, confirming the row lock is real, not assumed')
"
