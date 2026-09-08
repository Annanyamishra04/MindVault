-- MindVault: Phase 7 semantic search support
--
-- Phase 6 already created note_embeddings, match_notes, and
-- match_related_notes (migrations 0001/0003) as unused scaffolding — no
-- app code ever wrote or read them. This migration adds what Phase 7
-- actually needs to use them safely:
--
--   1. An explicit "stale" embedding_status, so the UI can distinguish
--      "never embedded" (pending) from "was embedded, but the note has
--      changed since" (stale) from "we tried and the provider failed"
--      (failed).
--   2. content_hash + embedding_model + embedding_dimensions columns on
--      note_embeddings, so the app can tell — without calling Gemini —
--      whether a stored embedding still represents the note's current
--      content and was produced by the model/config currently
--      configured. This is the "clean, reliable staleness strategy"
--      called for in the Phase 7 spec: a fingerprint of exactly what
--      was embedded, compared before ever regenerating or trusting a
--      vector.
--   3. match_notes/match_related_notes gain a match_embedding_model
--      filter, so if EMBEDDING_MODEL is ever changed without
--      re-embedding every note first, leftover vectors from the old,
--      incompatible embedding space are silently excluded from results
--      rather than corrupting similarity rankings by being compared
--      against vectors from a different model.
--
-- This migration does not touch 0001-0005 in place — it only adds
-- columns/constraints and replaces (via DROP + CREATE, since the
-- parameter list is changing) the two vector-search functions.

-- ---------------------------------------------------------------------
-- 1. embedding_status: add 'stale'
-- ---------------------------------------------------------------------

alter table public.notes drop constraint if exists notes_embedding_status_check;
alter table public.notes add constraint notes_embedding_status_check
  check (embedding_status in ('pending', 'ready', 'stale', 'failed'));

comment on column public.notes.embedding_status is
  'Cache of note_embeddings state for cheap UI reads, without joining note_embeddings on every note list render. pending = never successfully embedded. ready = the stored embedding matches the note''s current content and the currently configured model. stale = the note changed since the last successful embedding (or content is currently too large to index). failed = the last embedding attempt errored. This column is a hint only — note_embeddings.content_hash/embedding_model, compared in lib/ai/embeddings.ts, is the actual source of truth for whether a stored vector is current.';

-- ---------------------------------------------------------------------
-- 2. note_embeddings: content fingerprint + model/version metadata
-- ---------------------------------------------------------------------
--
-- Safe to add as NOT NULL without a backfill step: Phase 6 never wrote
-- a row to this table (see README's "Current AI Feature Status"), so
-- it is guaranteed empty in every environment this migration will ever
-- run against. A default is still supplied while adding the column
-- (required syntax when a table isn't provably empty to Postgres
-- itself) and dropped immediately after, so nothing can insert a row
-- that skips providing a real value going forward.

alter table public.note_embeddings
  add column if not exists content_hash text not null default '';
alter table public.note_embeddings alter column content_hash drop default;

alter table public.note_embeddings
  add column if not exists embedding_model text not null default 'gemini-embedding-2';
alter table public.note_embeddings alter column embedding_model drop default;

alter table public.note_embeddings
  add column if not exists embedding_dimensions int not null default 768;
alter table public.note_embeddings alter column embedding_dimensions drop default;

comment on column public.note_embeddings.content_hash is
  'SHA-256 hex digest of the exact {title, content} pair this embedding was generated from (see lib/ai/embeddings.ts::computeContentFingerprint). Comparing this to a freshly computed hash of the note''s current title/content is how the app detects a stale embedding without calling Gemini or trusting a mutable status flag alone.';
comment on column public.note_embeddings.embedding_model is
  'Identifies which embedding model produced this vector (e.g. "gemini-embedding-2"). Embedding spaces are not comparable across models — match_notes/match_related_notes filter on this so a leftover vector from a previously configured model can never be silently compared against, or returned alongside, vectors from the currently configured one.';
comment on column public.note_embeddings.embedding_dimensions is
  'Vector dimensionality requested when this embedding was generated. Stored alongside embedding_model as a second guard: the same model name could in principle be re-configured with a different output_dimensionality, which is just as incompatible as a different model entirely.';

-- ---------------------------------------------------------------------
-- 3. match_notes / match_related_notes: filter by embedding_model
-- ---------------------------------------------------------------------
--
-- Adding a parameter changes the function's identity in Postgres (it's
-- keyed on the full argument-type list), so CREATE OR REPLACE against
-- the old 4-argument signature would create a second, overloaded
-- function rather than replacing it. Drop the old signature explicitly
-- first so there is only ever one match_notes/match_related_notes.

drop function if exists public.match_notes(vector, uuid, int, float);
drop function if exists public.match_related_notes(uuid, uuid, int, float);

create function public.match_notes(
  query_embedding vector(768),
  match_user_id uuid,
  match_embedding_model text,
  match_count int default 8,
  match_threshold float default 0.3
)
returns table (
  note_id uuid,
  title text,
  content text,
  summary text,
  similarity float
)
language sql
stable
as $$
  select
    n.id as note_id,
    n.title,
    n.content,
    n.summary,
    1 - (ne.embedding <=> query_embedding) as similarity
  from public.note_embeddings ne
  join public.notes n on n.id = ne.note_id
  where ne.user_id = match_user_id
    and n.user_id = match_user_id
    and ne.embedding_model = match_embedding_model
    and 1 - (ne.embedding <=> query_embedding) > match_threshold
  order by ne.embedding <=> query_embedding
  limit match_count;
$$;

create function public.match_related_notes(
  target_note_id uuid,
  match_user_id uuid,
  match_embedding_model text,
  match_count int default 5,
  match_threshold float default 0.3
)
returns table (
  note_id uuid,
  title text,
  summary text,
  similarity float
)
language sql
stable
as $$
  select
    n.id as note_id,
    n.title,
    n.summary,
    1 - (ne.embedding <=> target.embedding) as similarity
  from public.note_embeddings ne
  join public.notes n on n.id = ne.note_id
  cross join (
    select embedding
    from public.note_embeddings
    where note_id = target_note_id
      and user_id = match_user_id
      and embedding_model = match_embedding_model
  ) as target
  where ne.user_id = match_user_id
    and n.user_id = match_user_id
    and ne.embedding_model = match_embedding_model
    and ne.note_id != target_note_id
    and 1 - (ne.embedding <=> target.embedding) > match_threshold
  order by ne.embedding <=> target.embedding
  limit match_count;
$$;

grant execute on function public.match_notes(vector, uuid, text, int, float) to authenticated;
grant execute on function public.match_related_notes(uuid, uuid, text, int, float) to authenticated;
