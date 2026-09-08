-- MindVault: case-insensitive tag uniqueness (Phase 4)
--
-- Migration 0001 created `unique (user_id, name)` on public.tags, which
-- is case-SENSITIVE — a single user could end up with "React", "react",
-- and "REACT" as three distinct rows. Phase 4 needs tags to be reusable
-- without users accidentally fragmenting them by casing, so we replace
-- that constraint with a case-insensitive one scoped per user.
--
-- This is a new migration rather than an edit to 0001/0002/0003: those
-- are treated as already applied to any existing environment, and
-- editing an applied migration in place would desync a live database's
-- migration history from the repo.

-- Drop the old case-sensitive constraint. The name matches Postgres's
-- default naming convention for an inline `unique (a, b)` table
-- constraint (`<table>_<col1>_<col2>_key`); guarded with IF EXISTS so
-- this migration is safe to run even if the constraint was already
-- renamed or removed by hand.
alter table public.tags drop constraint if exists tags_user_id_name_key;

-- Case-insensitive uniqueness per user: two tags for the same user can
-- never differ only by case. `lower()` is immutable for text, so this
-- is a plain (non-partial) unique index and works with Postgres's
-- standard ON CONFLICT / constraint-violation handling.
create unique index if not exists tags_user_id_name_lower_idx
  on public.tags (user_id, lower(name));

comment on index public.tags_user_id_name_lower_idx is
  'Case-insensitive per-user uniqueness for tag names (e.g. "React" and "react" cannot coexist for one user). Application code should still look up existing tags case-insensitively before inserting (see lib/notes/actions.ts) — this index is the enforcement backstop, not the primary dedup path.';
