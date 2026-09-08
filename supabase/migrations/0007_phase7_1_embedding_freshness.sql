-- MindVault: Phase 7.1 embedding concurrency/freshness fix
--
-- The write-time race that let an older embedding job mark a note
-- 'ready' after a newer save had already landed is fixed in
-- application code (lib/ai/reindex-coordinator.ts,
-- lib/ai/embeddings.ts). embedding_status is now only ever set to
-- 'ready' immediately after re-verifying, against the persisted note
-- row, that the embedding being written still matches the note's
-- current content.
--
-- This migration adds one more layer of defense-in-depth at the
-- database level: match_notes and match_related_notes already filter
-- on embedding_model (migration 0006), but neither previously checked
-- notes.embedding_status at all, so a note sitting in 'stale' (edited,
-- reindex not caught up yet) or 'failed' could still have its old
-- vector considered for similarity ranking. Filtering on
-- embedding_status = 'ready' here means that even if some future code
-- path ever got the write-time check wrong, a note whose cached status
-- isn't 'ready' can never be returned by either RPC.
--
-- This does not replace the application-level content_hash check in
-- lib/ai/actions.ts::getRelatedNotes (which additionally re-verifies
-- content_hash/embedding_model/embedding_dimensions against the note's
-- live content before ever calling match_related_notes) — that check
-- catches a stale vector even when embedding_status itself is
-- (incorrectly, or not-yet-updated) 'ready'. The two are independent
-- layers, not substitutes for each other.
--
-- Signature is unchanged from migration 0006, so `create or replace`
-- is sufficient here (no DROP FUNCTION needed).

create or replace function public.match_notes(
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
    and n.embedding_status = 'ready'
    and 1 - (ne.embedding <=> query_embedding) > match_threshold
  order by ne.embedding <=> query_embedding
  limit match_count;
$$;

create or replace function public.match_related_notes(
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
    and n.embedding_status = 'ready'
    and ne.note_id != target_note_id
    and 1 - (ne.embedding <=> target.embedding) > match_threshold
  order by ne.embedding <=> target.embedding
  limit match_count;
$$;

-- Grants are unaffected by CREATE OR REPLACE against the same
-- signature, but re-stated here for clarity/idempotency.
grant execute on function public.match_notes(vector, uuid, text, int, float) to authenticated;
grant execute on function public.match_related_notes(uuid, uuid, text, int, float) to authenticated;
