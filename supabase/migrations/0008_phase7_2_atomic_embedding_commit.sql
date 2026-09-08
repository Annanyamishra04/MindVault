-- MindVault: Phase 7.2 final concurrency fix
--
-- ---------------------------------------------------------------------
-- THE REMAINING RACE
-- ---------------------------------------------------------------------
--
-- Phase 7.1 (migration 0007 + lib/ai/reindex-coordinator.ts) reloaded
-- the note and re-checked its content fingerprint immediately before
-- writeEmbedding()/setStatus('ready') ran. That check happened in
-- application code (JavaScript), and the write that followed it was
-- two separate statements (an upsert into note_embeddings, then an
-- UPDATE of notes.embedding_status) issued moments later over the
-- network. Between "check passed" and "both writes landed" there is
-- always a window — however small — in which a second save can commit.
-- Two concurrent reindex attempts can both pass their own JS-level
-- check before either has written anything; whichever's writes land
-- last still wins, even though it's for older content. A
-- JavaScript-level check immediately before a write is fundamentally
-- unable to close this, because the check and the write are not the
-- same operation as far as Postgres is concerned.
--
-- Final state that must be impossible:
--   current note content = Version B
--   stored embedding      = Version A
--   embedding_status      = 'ready'
--
-- ---------------------------------------------------------------------
-- THE FIX: content_version + atomic commit functions
-- ---------------------------------------------------------------------
--
-- 1. notes.content_version — a plain integer counter, bumped by a
--    trigger whenever title or content actually changes. This is
--    Option B from the review request, chosen deliberately over
--    reproducing lib/ai/embedding-fingerprint.ts's SHA-256 formatting
--    in SQL (Option A): matching Node's exact hash byte-for-byte would
--    mean re-implementing its `${len}:${text}\0${len}:${text}` framing
--    and its `.trim()` semantics (JS's `String.prototype.trim()` strips
--    a broader set of Unicode whitespace than Postgres's default
--    `trim()`) inside a second, independently-maintained
--    implementation — exactly the "two subtly different
--    implementations of the same fingerprint" trap the review called
--    out. An incrementing integer needs none of that: it doesn't care
--    what changed, only whether *anything* did, which is all the
--    write-time race actually needs to know. content_hash (added in
--    migration 0006, unchanged here) remains the source of truth for
--    "does this stored vector represent this exact text" (used by
--    isAlreadyCurrent/isEmbeddingCurrent) — content_version is a
--    separate, narrower concept: "has the row moved since I last read
--    it", used only to guard the write.
--
-- 2. commit_note_embedding() / confirm_note_embedding_ready() — the
--    functions embeddings.ts now calls instead of a plain upsert +
--    UPDATE. Each does `SELECT ... FOR UPDATE` on the note row first,
--    which blocks any concurrent notes UPDATE (including the trigger
--    below firing from a real save) until this function's transaction
--    finishes. Inside that lock, it compares content_version to the
--    version the caller says it embedded, and only writes
--    note_embeddings / embedding_status if they still match — all
--    inside the one transaction Postgres already wraps a single
--    function call in. There is no gap between the check and the write
--    for a concurrent save to land in, because nothing else can even
--    acquire the row lock until this transaction commits or rolls
--    back. This is Option A (conditional database operation) and
--    Option C (focused RPC) combined, applied at both call sites that
--    can mark a note 'ready' (a fresh embed, and the "already current"
--    skip path — see reindex-coordinator.ts's confirmReady doc for why
--    the skip path needs this too).
--
-- Both functions are SECURITY INVOKER (the default, omitted explicitly
-- for clarity, same convention as every other RPC in this project) and
-- derive the caller from auth.uid(), so RLS on notes/note_embeddings
-- still applies exactly as it does for any other query — a caller can
-- never lock, read, or write another user's note or embedding through
-- these functions. No service role, no SECURITY DEFINER.
--
-- ---------------------------------------------------------------------
-- UPDATE-FLOW SIDE EFFECT: invalidation moves into the trigger
-- ---------------------------------------------------------------------
--
-- lib/notes/actions.ts::updateNote() used to flip embedding_status from
-- 'ready' to 'stale' with a second, separate UPDATE issued right after
-- the title/content UPDATE. That was itself a smaller instance of the
-- same class of bug: a second statement, not atomic with the first,
-- during which an in-flight commit_note_embedding() from an old job
-- could (at least in principle) have already re-locked the row. The
-- trigger below does the same invalidation as part of the *same*
-- UPDATE statement that changes title/content, which is both simpler
-- and strictly safer — see lib/notes/actions.ts for the corresponding
-- removal.

-- ---------------------------------------------------------------------
-- 1. content_version
-- ---------------------------------------------------------------------

alter table public.notes
  add column if not exists content_version integer not null default 1;

comment on column public.notes.content_version is
  'Increments whenever title or content actually changes (see bump_note_content_version() trigger below). This is the version an in-flight embedding job pins itself to: commit_note_embedding()/confirm_note_embedding_ready() only mark a note ready if content_version still matches the version that was current when the job started, which is what makes "newer content + older embedding + ready" impossible even under concurrent writes. Not a general-purpose optimistic-concurrency column for the rest of the app — scoped to this one purpose.';

create or replace function public.bump_note_content_version()
returns trigger as $$
begin
  if new.title is distinct from old.title or new.content is distinct from old.content then
    new.content_version := old.content_version + 1;

    -- Same-statement invalidation: a previously-current embedding no
    -- longer represents this row the instant title/content changes.
    -- Only flip 'ready' -> 'stale'; 'pending'/'failed'/already-'stale'
    -- have no previously-current state to invalidate, matching the
    -- app-level behavior this replaces (see lib/notes/actions.ts).
    if old.embedding_status = 'ready' then
      new.embedding_status := 'stale';
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists bump_note_content_version on public.notes;
create trigger bump_note_content_version
  before update on public.notes
  for each row execute function public.bump_note_content_version();

-- note_embeddings: record which content_version an embedding was
-- generated from, alongside the existing content_hash. content_hash
-- stays the authority for "is this the right text"; this column exists
-- so a stored embedding row can be inspected against the version
-- history if ever needed for debugging, and so commit_note_embedding()
-- has a natural column to write the version into without overloading
-- content_hash's meaning.
alter table public.note_embeddings
  add column if not exists note_content_version integer;

comment on column public.note_embeddings.note_content_version is
  'notes.content_version at the moment this embedding was committed (see commit_note_embedding()). Informational / debugging aid — content_hash remains the actual freshness check used by application code.';

-- ---------------------------------------------------------------------
-- 2. commit_note_embedding — atomic write-time commit
-- ---------------------------------------------------------------------

create or replace function public.commit_note_embedding(
  p_note_id uuid,
  p_expected_version integer,
  p_content_hash text,
  p_embedding vector(768),
  p_embedding_model text,
  p_embedding_dimensions int
)
returns boolean
language plpgsql
as $$
declare
  v_user_id uuid := auth.uid();
  v_current_version integer;
begin
  if v_user_id is null then
    raise exception 'Not authenticated.';
  end if;

  -- Lock the note row for the rest of this transaction. RLS (auth.uid()
  -- = user_id) still applies to this SELECT — a caller can never lock,
  -- inspect, or embed a note it doesn't own; a mismatched/foreign
  -- note_id simply returns no row below. Holding the lock for the
  -- remainder of the function is what makes the version check and the
  -- writes atomic: no concurrent UPDATE on this row (including a real
  -- title/content save, which would bump content_version via the
  -- trigger above) can proceed until this transaction ends.
  select content_version into v_current_version
  from public.notes
  where id = p_note_id
    and user_id = v_user_id
  for update;

  if v_current_version is null then
    -- Note doesn't exist, isn't visible under RLS, or isn't owned by
    -- the caller. Nothing to commit.
    return false;
  end if;

  if v_current_version <> p_expected_version then
    -- A newer save landed after this embedding job read its snapshot.
    -- Discard the embedding: do not touch note_embeddings, do not
    -- touch embedding_status. The caller (reindex-coordinator.ts)
    -- reloads and retries for whatever is current now.
    return false;
  end if;

  insert into public.note_embeddings (
    note_id, user_id, embedding, content_hash,
    embedding_model, embedding_dimensions, note_content_version
  )
  values (
    p_note_id, v_user_id, p_embedding, p_content_hash,
    p_embedding_model, p_embedding_dimensions, p_expected_version
  )
  on conflict (note_id) do update
    set embedding = excluded.embedding,
        content_hash = excluded.content_hash,
        embedding_model = excluded.embedding_model,
        embedding_dimensions = excluded.embedding_dimensions,
        note_content_version = excluded.note_content_version,
        user_id = excluded.user_id;

  -- content_version = p_expected_version is redundant given the row
  -- lock above (nothing could have changed it since), but restated
  -- here as defense-in-depth rather than relying solely on the lock.
  update public.notes
    set embedding_status = 'ready'
    where id = p_note_id
      and content_version = p_expected_version;

  return true;
end;
$$;

grant execute on function public.commit_note_embedding(uuid, integer, text, vector, text, int) to authenticated;

-- ---------------------------------------------------------------------
-- 3. confirm_note_embedding_ready — atomic skip-path commit
-- ---------------------------------------------------------------------
--
-- Used when isAlreadyCurrent(fingerprint) finds a stored embedding that
-- already matches the note's current content — nothing needs
-- re-embedding, but embedding_status still needs to (re-)become
-- 'ready', and that write needs the same version guard as
-- commit_note_embedding(). Without it, this path would be exactly the
-- unguarded `UPDATE notes SET embedding_status = 'ready' WHERE id = ?`
-- the Phase 7.2 review specifically calls out as insufficient.
create or replace function public.confirm_note_embedding_ready(
  p_note_id uuid,
  p_expected_version integer
)
returns boolean
language plpgsql
as $$
declare
  v_user_id uuid := auth.uid();
  v_current_version integer;
begin
  if v_user_id is null then
    raise exception 'Not authenticated.';
  end if;

  select content_version into v_current_version
  from public.notes
  where id = p_note_id
    and user_id = v_user_id
  for update;

  if v_current_version is null or v_current_version <> p_expected_version then
    return false;
  end if;

  update public.notes
    set embedding_status = 'ready'
    where id = p_note_id
      and content_version = p_expected_version;

  return true;
end;
$$;

grant execute on function public.confirm_note_embedding_ready(uuid, integer) to authenticated;
