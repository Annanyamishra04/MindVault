-- MindVault: Phase 4.1 reliability & security hardening
--
-- Three RPCs, all SECURITY INVOKER (the default — omitted explicitly
-- below just to be unambiguous) so RLS on notes/tags/note_tags still
-- applies exactly as it does for any other query. Every function also
-- derives the caller from auth.uid() itself and scopes writes/reads to
-- that user as defense in depth, mirroring the existing convention in
-- 0003_vector_search.sql.

-- ---------------------------------------------------------------------
-- 1. search_note_ids — replaces string-built PostgREST `.or()` filters
-- ---------------------------------------------------------------------
--
-- Previously, lib/notes/queries.ts built a `.or()` filter expression by
-- interpolating the user's search text directly into PostgREST filter
-- grammar (`title.ilike.%<term>%,content.ilike.%<term>%`), escaping only
-- `%` and `_`. PostgREST's filter grammar uses `,` to separate
-- conditions, `.` to separate column/operator/value, and `()` for
-- grouping — none of which were escaped, so a comma or parenthesis in
-- the search box could append extra filter conditions and change what
-- the query actually matched, not just what it searched for.
--
-- The fix moves the match entirely into a bound RPC parameter. Supabase
-- sends `search_pattern` as a plain value in the RPC call's JSON body,
-- never as text spliced into a filter string, so there is no filter
-- grammar for it to break out of — this class of bug is structurally
-- eliminated rather than patched with more escaping.
create or replace function public.search_note_ids(search_pattern text)
returns table (note_id uuid)
language sql
stable
as $$
  select n.id as note_id
  from public.notes n
  where n.user_id = auth.uid()
    and (n.title ilike search_pattern or n.content ilike search_pattern)
  order by n.updated_at desc;
$$;

grant execute on function public.search_note_ids(text) to authenticated;

-- ---------------------------------------------------------------------
-- 2. get_or_create_tag — atomic, race-free tag upsert
-- ---------------------------------------------------------------------
--
-- Replaces the previous check-then-insert-then-catch-23505 dance in
-- lib/notes/actions.ts. That approach was *eventually* correct under a
-- race (the 23505 recovery path did fetch the winning row), but the
-- initial existence check used `.ilike("name", name)` for what was
-- meant to be an exact, case-insensitive match — if a tag name itself
-- contained `%` or `_`, ilike treated them as wildcards, so the lookup
-- could match (or miss) the wrong tag entirely. That's the same class
-- of "user input silently changes query semantics" problem as the
-- search issue above, just on a different query.
--
-- `INSERT ... ON CONFLICT (user_id, lower(name)) DO UPDATE ... RETURNING`
-- is a single atomic statement: Postgres itself serializes concurrent
-- conflicting inserts (the second waits for the first to commit, then
-- applies the DO UPDATE against the row that won), and it always
-- returns the row-that-exists-after, whether that's the row this call
-- just inserted or one from a concurrent request. The DO UPDATE clause
-- is a no-op (name = tags.name) — it exists only so RETURNING fires for
-- the pre-existing-row case too, since DO NOTHING returns nothing.
create or replace function public.get_or_create_tag(p_name text)
returns table (id uuid, name text)
language plpgsql
as $$
#variable_conflict use_column
declare
  v_user_id uuid := auth.uid();
begin
  -- The OUT parameters implied by `returns table (id, name)` declare
  -- plpgsql variables literally named `id`/`name`, which would
  -- otherwise shadow tags.id/tags.name below and make every bare
  -- reference to those columns ambiguous. `use_column` tells plpgsql
  -- to prefer the table column whenever a name is ambiguous like that.
  if v_user_id is null then
    raise exception 'Not authenticated.';
  end if;

  return query
  insert into public.tags (user_id, name)
  values (v_user_id, p_name)
  on conflict (user_id, lower(name)) do update
    set name = tags.name
  returning tags.id, tags.name;
end;
$$;

grant execute on function public.get_or_create_tag(text) to authenticated;

-- ---------------------------------------------------------------------
-- 3. create_note_with_tags — atomic note creation + initial tagging
-- ---------------------------------------------------------------------
--
-- Previously, createNote() in lib/notes/actions.ts inserted the note,
-- then looped over requested tags attaching them one at a time with
-- `if ("error" in tag) continue;` — a tag failure was silently dropped;
-- the note would report success even though some (or all) requested
-- tags never got attached, and the user was never told.
--
-- This function does the whole operation — note insert, per-tag
-- upsert, and note_tags linking — inside a single PL/pgSQL function
-- body, which Postgres runs as one implicit transaction. If any step
-- raises (including a constraint violation this function doesn't
-- explicitly handle), the entire function's effects roll back,
-- including the note insert itself: there is no state where the note
-- exists but a requested tag silently failed to attach. This is Option
-- A from the review request (full atomicity) rather than Option B
-- (compensating/reporting), since the tag upsert above already made
-- atomicity cheap to get — no separate reporting path was needed.
create or replace function public.create_note_with_tags(
  p_title text,
  p_content text,
  p_is_favorite boolean,
  p_tag_names text[]
)
returns uuid
language plpgsql
as $$
declare
  v_user_id uuid := auth.uid();
  v_note_id uuid;
  v_tag_ids uuid[];
begin
  if v_user_id is null then
    raise exception 'Not authenticated.';
  end if;

  insert into public.notes (user_id, title, content, is_favorite)
  values (v_user_id, p_title, coalesce(p_content, ''), coalesce(p_is_favorite, false))
  returning id into v_note_id;

  if p_tag_names is not null and array_length(p_tag_names, 1) > 0 then
    -- Upsert the tags and collect their ids as their own statement,
    -- separate from the note_tags insert below. This matters for more
    -- than style: note_tags' RLS policy checks `exists (select 1 from
    -- tags where tags.id = note_tags.tag_id and tags.user_id =
    -- auth.uid())`, and a brand-new tag row inserted by a sibling CTE
    -- within the *same* SQL command is not visible to that check —
    -- writable CTEs in Postgres only expose their RETURNING rows to
    -- the CTE reference itself, not to unrelated table scans (like an
    -- RLS policy's own subquery) within that same command. Splitting
    -- this into two statements advances the command counter in
    -- between, so the note_tags insert's RLS check runs against a
    -- snapshot that already includes the tags this function just
    -- created.
    with wanted as (
      -- Case-insensitively de-duplicated, non-blank tag names from the
      -- input array — collapsed to one representative spelling per
      -- distinct lower(name) group (the first one that appeared in
      -- p_tag_names) *before* the insert below, not via ON CONFLICT.
      -- ON CONFLICT only de-dupes against rows that already existed
      -- before this statement started; it can't resolve a conflict
      -- between two new rows inserted by the same statement (e.g.
      -- "Go" and "go" both being brand new tags in one call) — that
      -- raises "ON CONFLICT DO UPDATE command cannot affect row a
      -- second time" instead. Doing the case-insensitive collapse
      -- ourselves means the insert below only ever attempts one row
      -- per distinct lower(name), so that failure mode can't occur.
      select distinct on (lower(t.name)) t.name
      from unnest(p_tag_names) with ordinality as t (name, ord)
      where t.name is not null and length(trim(t.name)) > 0
      order by lower(t.name), t.ord
    ),
    upserted as (
      insert into public.tags (user_id, name)
      select v_user_id, wanted.name from wanted
      on conflict (user_id, lower(name)) do update
        set name = tags.name
      returning id
    )
    select array_agg(id) into v_tag_ids from upserted;

    if v_tag_ids is not null then
      insert into public.note_tags (note_id, tag_id)
      select v_note_id, tag_id from unnest(v_tag_ids) as tag_id
      -- Two distinct requested names can resolve to the same existing
      -- tag id (e.g. "React" and "react" in the same request) — avoid
      -- a note_tags primary-key violation in that case.
      on conflict (note_id, tag_id) do nothing;
    end if;
  end if;

  return v_note_id;
end;
$$;

grant execute on function public.create_note_with_tags(text, text, boolean, text[]) to authenticated;
