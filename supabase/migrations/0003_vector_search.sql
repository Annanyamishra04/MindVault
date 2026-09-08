-- MindVault: vector similarity search
--
-- These functions run the actual nearest-neighbor search in SQL via
-- pgvector, rather than pulling all embeddings into Node and computing
-- cosine similarity in JavaScript. They are SECURITY INVOKER (the
-- default), so they run with the calling user's privileges and RLS on
-- note_embeddings/notes still applies — the explicit user_id filter is
-- defense in depth, not a substitute for RLS.

-- match_notes: used by both semantic search and the RAG pipeline in
-- Ask My Notes. Returns notes ordered by embedding similarity to the
-- given query vector.
create or replace function public.match_notes(
  query_embedding vector(768),
  match_user_id uuid,
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
    and 1 - (ne.embedding <=> query_embedding) > match_threshold
  order by ne.embedding <=> query_embedding
  limit match_count;
$$;

-- match_related_notes: same idea, but for the "Related Notes" panel on a
-- note's detail page — excludes the note itself.
create or replace function public.match_related_notes(
  target_note_id uuid,
  match_user_id uuid,
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
  ) as target
  where ne.user_id = match_user_id
    and n.user_id = match_user_id
    and ne.note_id != target_note_id
    and 1 - (ne.embedding <=> target.embedding) > match_threshold
  order by ne.embedding <=> target.embedding
  limit match_count;
$$;

grant execute on function public.match_notes(vector, uuid, int, float) to authenticated;
grant execute on function public.match_related_notes(uuid, uuid, int, float) to authenticated;
