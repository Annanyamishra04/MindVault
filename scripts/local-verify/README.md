# Local migration & RLS verification harness

This folder is **not part of the application**. It's a throwaway test
harness used to verify `supabase/migrations/*.sql` against a real local
Postgres + pgvector instance, without needing a live Supabase project.
It exists because "the RLS policies look correct" and "the RLS policies
are correct" are different claims — this proves the second one.

It approximates the two things a real Supabase project provides that a
plain Postgres install doesn't: the `auth` schema (specifically
`auth.users` and `auth.uid()`), and the `authenticated` role's default
table grants. Everything else is the actual, unmodified migration
files from `supabase/migrations/`.

## Requirements

Postgres 16 with the `pgvector` extension available. On Debian/Ubuntu:

```bash
sudo apt-get install postgresql-16 postgresql-16-pgvector
sudo service postgresql start
```

## Running it

```bash
sudo -u postgres createdb mindvault_test

sudo -u postgres psql -d mindvault_test -v ON_ERROR_STOP=1 -f scripts/local-verify/00_supabase_stub.sql
sudo -u postgres psql -d mindvault_test -v ON_ERROR_STOP=1 -f supabase/migrations/0001_init_schema.sql
sudo -u postgres psql -d mindvault_test -v ON_ERROR_STOP=1 -f supabase/migrations/0002_rls_policies.sql
sudo -u postgres psql -d mindvault_test -v ON_ERROR_STOP=1 -f supabase/migrations/0003_vector_search.sql
sudo -u postgres psql -d mindvault_test -v ON_ERROR_STOP=1 -f scripts/local-verify/00b_platform_grants.sql

sudo -u postgres psql -d mindvault_test -v ON_ERROR_STOP=1 -f scripts/local-verify/01_rls_checks.sql
sudo -u postgres psql -d mindvault_test -v ON_ERROR_STOP=1 -f supabase/migrations/0004_tag_case_insensitive_uniqueness.sql
sudo -u postgres psql -d mindvault_test -v ON_ERROR_STOP=1 -f scripts/local-verify/02_phase4_checks.sql
sudo -u postgres psql -d mindvault_test -v ON_ERROR_STOP=1 -f supabase/migrations/0005_phase4_1_security_reliability.sql
sudo -u postgres psql -d mindvault_test -v ON_ERROR_STOP=1 -f scripts/local-verify/03_phase4_1_checks.sql
```

`01_rls_checks.sql` creates two users (Alice and Bob), gives each their
own notes/tags/embeddings, then runs as Bob and asserts — with a real
`ASSERT`, not just eyeballing output — that he cannot read, update,
delete, or otherwise touch any of Alice's rows across every table,
including via the `match_notes` RPC. If every assertion holds, it
prints `=== ALL RLS CHECKS PASSED ===`; if any policy were wrong, the
script aborts immediately at that assertion instead.

`02_phase4_checks.sql` (added in Phase 4) reuses Alice and Bob to verify
two things migration 0004 and the notes CRUD layer depend on: that a
user cannot create two tags differing only by case (e.g. "security" and
"Security"), that this restriction is per-user rather than global, and
that deleting a note cascades to `note_tags` and `note_embeddings` with
no orphaned rows. Run it after `0004_tag_case_insensitive_uniqueness.sql`
has been applied.

`03_phase4_1_checks.sql` (added in Phase 4.1) verifies the three
functions added in `0005_phase4_1_security_reliability.sql`:
`search_note_ids` matches the caller's own notes and stays scoped to
them even when a filter-grammar-laden or cross-user-matching pattern is
passed directly; `get_or_create_tag` reuses an existing tag
case-insensitively without creating a duplicate row, including for
brand-new tag names differing only by case; and `create_note_with_tags`
creates a note and its initial tags atomically, deduplicates tag names
that differ only by case within a single call, and rejects
unauthenticated calls before writing anything. Run it after
`0005_phase4_1_security_reliability.sql` has been applied.

`0N_*_checks.sql` files above are all ordinary single-session scripts.
Phase 7.2 (migration `0008_phase7_2_atomic_embedding_commit.sql`) is the
one exception, because part of what it needs to prove — that
`commit_note_embedding()`'s row lock actually blocks a concurrent
writer — can't be demonstrated from a single `psql -f` session. Run it
as:

```bash
sudo -u postgres psql -d mindvault_test -v ON_ERROR_STOP=1 -f supabase/migrations/0008_phase7_2_atomic_embedding_commit.sql
sudo -u postgres bash scripts/local-verify/04b_phase7_2_concurrency_test.sh
sudo -u postgres psql -d mindvault_test -v ON_ERROR_STOP=1 -f scripts/local-verify/04_phase7_2_checks.sql
```

`04b_phase7_2_concurrency_test.sh` runs two real, concurrent Postgres
sessions: one holds `commit_note_embedding`'s row lock for 3 seconds
(simulating a slow in-flight embedding write for content version 1)
while a second session attempts to save new content on the same note
about a second in. It asserts the second session actually blocks for
roughly the remainder of that window (proving the lock is real, not
assumed) and that once it proceeds, `content_version` is 2 and
`embedding_status` is `'stale'` — the first session's `'ready'` write
correctly invalidated by the trigger, not overwritten afterward. It
leaves the database in the state `04_phase7_2_checks.sql`'s part (b)
picks up from. `04_phase7_2_checks.sql` then verifies
`commit_note_embedding`/`confirm_note_embedding_ready` reject a stale
`content_version`, accept the current one, and can't be used
cross-user against another user's note.

## When to re-run this

Any time you change a migration file — especially RLS policies — before
applying it to your real Supabase project. Drop and recreate
`mindvault_test` each time for a clean run (the scripts aren't
idempotent by design, since re-running against leftover data would
weaken the assertions).
