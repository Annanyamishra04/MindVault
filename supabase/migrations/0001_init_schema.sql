-- MindVault: core schema
-- Enables pgvector and creates all base tables.

create extension if not exists vector;

-- profiles: mirrors auth.users, extended with app-specific fields.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- notes: the core content table.
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'Untitled note',
  content text not null default '',
  summary text,
  key_points text[],
  is_favorite boolean not null default false,
  -- Tracks whether note_embeddings has a current vector for this note,
  -- so the UI can show "indexing..." and semantic search can skip notes
  -- that aren't ready yet.
  embedding_status text not null default 'pending'
    check (embedding_status in ('pending', 'ready', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Note: no standalone index on notes(user_id) — the composite index
-- below already covers plain "WHERE user_id = ?" lookups via its
-- leftmost column, so a separate single-column index would just add
-- write overhead without helping any query.
create index if not exists notes_user_id_updated_at_idx on public.notes (user_id, updated_at desc);
create index if not exists notes_user_id_is_favorite_idx on public.notes (user_id, is_favorite);

-- tags: per-user, reusable across notes.
create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create index if not exists tags_user_id_idx on public.tags (user_id);

-- note_tags: many-to-many join table.
create table if not exists public.note_tags (
  note_id uuid not null references public.notes (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete cascade,
  primary key (note_id, tag_id)
);

create index if not exists note_tags_tag_id_idx on public.note_tags (tag_id);

-- note_embeddings: one vector per note, kept separate from `notes` so
-- re-embedding doesn't rewrite the note row and the vector index only
-- covers what needs it.
--
-- Dimension (768) matches Google's `gemini-embedding-2` model (the
-- app's current default; `gemini-embedding-001` used the same 768
-- setting), which natively outputs 3072 dimensions but is trained with
-- Matryoshka Representation Learning (MRL), so it supports truncation
-- via `output_dimensionality`. We request 768 dimensions: Google's own
-- guidance says 768/1536/3072 all retain most of the model's quality,
-- and 768 keeps storage and compute cheap on the free tier while
-- staying under pgvector's 2000-dimension limit for ivfflat/HNSW
-- indexes (3072 would not be indexable at all). If the embedding model
-- or its configured output dimension ever changes, this column must be
-- recreated (drop + re-add + re-embed all notes) and
-- lib/ai/gemini.ts's `output_dimensionality` and `embeddingDimensions`
-- must be updated to match exactly.
create table if not exists public.note_embeddings (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null unique references public.notes (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  embedding vector(768) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists note_embeddings_user_id_idx on public.note_embeddings (user_id);

-- No ANN index (ivfflat/HNSW) on `embedding` for now — deliberately.
-- A personal notes app realistically holds low hundreds to a few
-- thousand rows per user; at that scale, pgvector's brute-force exact
-- search over `<=>` (used directly in match_notes/match_related_notes)
-- is fast (single-digit milliseconds) and, unlike an approximate index,
-- is always 100% accurate. An IVFFlat/HNSW index would also actively
-- hurt correctness here: both queries filter by user_id, and ANN
-- indexes select their candidate set *before* that filter is applied,
-- so a user with few rows relative to `lists`/`ef_search` can get zero
-- or incomplete results even when good matches exist. Add an index
-- only if a single user's note count grows large enough (roughly
-- 10,000+) that sequential scan latency becomes a real problem — at
-- that point, prefer HNSW with `vector_cosine_ops` over IVFFlat, since
-- it doesn't require retraining as data grows.

-- Keep `updated_at` current on every update.
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_updated_at on public.notes;
create trigger set_updated_at
  before update on public.notes
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.note_embeddings;
create trigger set_updated_at
  before update on public.note_embeddings
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.profiles;
create trigger set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-create a profile row whenever a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep profiles.email in sync if the user changes their email via
-- Supabase Auth. Without this, profiles.email would only ever reflect
-- the address at signup — a real data-consistency bug, since the two
-- would silently diverge the first time anyone changes their email.
create or replace function public.handle_user_email_update()
returns trigger as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_email_updated on auth.users;
create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row execute function public.handle_user_email_update();
