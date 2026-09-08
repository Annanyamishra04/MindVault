-- MindVault: Row Level Security
--
-- Every table is user-scoped. Policies enforce that a user can only ever
-- read or write rows where user_id = auth.uid() (or, for note_tags,
-- where the referenced note belongs to them). This is enforced at the
-- database level, independent of any application code, so a bug in a
-- route handler cannot leak another user's data.

alter table public.profiles enable row level security;
alter table public.notes enable row level security;
alter table public.tags enable row level security;
alter table public.note_tags enable row level security;
alter table public.note_embeddings enable row level security;

-- profiles ------------------------------------------------------------

create policy "Users can view their own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- notes -----------------------------------------------------------------

create policy "Users can view their own notes"
  on public.notes for select
  using (auth.uid() = user_id);

create policy "Users can insert their own notes"
  on public.notes for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own notes"
  on public.notes for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own notes"
  on public.notes for delete
  using (auth.uid() = user_id);

-- tags --------------------------------------------------------------------

create policy "Users can view their own tags"
  on public.tags for select
  using (auth.uid() = user_id);

create policy "Users can insert their own tags"
  on public.tags for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own tags"
  on public.tags for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own tags"
  on public.tags for delete
  using (auth.uid() = user_id);

-- note_tags (scoped via the parent note's ownership) -----------------------

create policy "Users can view tags on their own notes"
  on public.note_tags for select
  using (
    exists (
      select 1 from public.notes
      where notes.id = note_tags.note_id
        and notes.user_id = auth.uid()
    )
  );

create policy "Users can tag their own notes"
  on public.note_tags for insert
  with check (
    exists (
      select 1 from public.notes
      where notes.id = note_tags.note_id
        and notes.user_id = auth.uid()
    )
    and exists (
      select 1 from public.tags
      where tags.id = note_tags.tag_id
        and tags.user_id = auth.uid()
    )
  );

create policy "Users can untag their own notes"
  on public.note_tags for delete
  using (
    exists (
      select 1 from public.notes
      where notes.id = note_tags.note_id
        and notes.user_id = auth.uid()
    )
  );

-- note_embeddings -----------------------------------------------------------
--
-- Note: it's not enough to check `auth.uid() = user_id` here alone — a
-- user could otherwise set user_id to themselves while pointing note_id
-- at a note they don't own (the FK only requires the note to exist,
-- not that it belongs to them). Since note_id is UNIQUE, that would
-- also permanently block the real owner from ever embedding their own
-- note. Every write policy therefore also confirms the referenced note
-- belongs to the caller, mirroring the note_tags policies above.

create policy "Users can view their own note embeddings"
  on public.note_embeddings for select
  using (auth.uid() = user_id);

create policy "Users can insert embeddings for their own notes"
  on public.note_embeddings for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.notes
      where notes.id = note_embeddings.note_id
        and notes.user_id = auth.uid()
    )
  );

create policy "Users can update embeddings for their own notes"
  on public.note_embeddings for update
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.notes
      where notes.id = note_embeddings.note_id
        and notes.user_id = auth.uid()
    )
  );

create policy "Users can delete their own note embeddings"
  on public.note_embeddings for delete
  using (auth.uid() = user_id);
