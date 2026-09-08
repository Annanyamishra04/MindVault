"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { reindexNoteEmbedding } from "@/lib/ai/embeddings";
import {
  createNoteSchema,
  updateNoteSchema,
  tagNameSchema,
  type CreateNoteInput,
  type UpdateNoteInput,
} from "@/lib/validation/notes";

/**
 * Every mutation in this file follows the same shape:
 *
 *   1. Get the authenticated user server-side via supabase.auth.getUser()
 *      — never trust a user id passed in from the client.
 *   2. Re-validate input with Zod, even though the client already did —
 *      the client check is UX, this is the actual boundary.
 *   3. Perform the write with the cookie-scoped (RLS-enforced) Supabase
 *      client, so ownership is checked by Postgres itself, not just by
 *      application logic.
 *   4. Revalidate whatever routes could now be showing stale data.
 *
 * Results are returned as plain `{ success, ... }` objects rather than
 * thrown errors, so client components can show a specific message
 * (rather than Next.js's generic "something went wrong" for anything
 * thrown out of a Server Action) and, for optimistic UI, know exactly
 * when to roll back.
 */

type ActionResult<T = undefined> =
  | ({ success: true } & (T extends undefined ? object : { data: T }))
  | { success: false; error: string };

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("Not authenticated.");
  }
  return { supabase, userId: user.id };
}

/**
 * Finds an existing tag for this user matching `name` case-insensitively,
 * or creates one, via the get_or_create_tag() RPC (migration 0005).
 *
 * This used to be a check-then-insert-then-catch-23505 dance in app
 * code: select with `.ilike("name", name)` for an "exact" case-insensitive
 * match, insert if nothing came back, and on a 23505 unique-violation
 * (a race between two requests creating the same tag) re-select to
 * fetch the winner. Two problems with that: the `.ilike()` existence
 * check treated `%`/`_` in the tag name as wildcards rather than
 * literal characters, so a tag named e.g. "50%" could match or miss
 * the wrong row; and the race was only correct *eventually*, via a
 * second round-trip.
 *
 * The RPC replaces both with one atomic `INSERT ... ON CONFLICT
 * (user_id, lower(name)) DO UPDATE ... RETURNING` statement — Postgres
 * itself serializes concurrent conflicting inserts and always returns
 * the resulting row, whether it's the one this call just inserted or
 * one a concurrent request just committed. See migration 0005 for the
 * full explanation.
 */
async function getOrCreateTagId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rawName: string,
): Promise<{ id: string; name: string } | { error: string }> {
  const parsed = tagNameSchema.safeParse(rawName);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid tag name." };
  }

  const { data, error } = await supabase
    .rpc("get_or_create_tag", { p_name: parsed.data })
    .single();

  if (error || !data) {
    return { error: "Couldn't create tag." };
  }

  return data;
}

export async function createNote(input: CreateNoteInput): Promise<ActionResult<{ id: string }>> {
  const parsed = createNoteSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid note." };
  }

  const { supabase } = await requireUser();
  const { title, content, isFavorite, tags } = parsed.data;

  // Note creation and initial tag attachment happen atomically inside
  // create_note_with_tags() (migration 0005): the note insert, per-tag
  // upsert, and note_tags linking all run in one PL/pgSQL function
  // body, which Postgres executes as a single transaction. If anything
  // fails, everything rolls back — there's no longer a state where the
  // note exists but a requested tag silently failed to attach (the
  // previous implementation attached tags one at a time in a loop with
  // `if ("error" in tag) continue`, which dropped failures silently).
  const uniqueTagNames = Array.from(new Set(tags.map((t) => t.trim()).filter(Boolean)));

  const { data: noteId, error } = await supabase.rpc("create_note_with_tags", {
    p_title: title,
    p_content: content,
    p_is_favorite: isFavorite,
    p_tag_names: uniqueTagNames,
  });

  if (error || !noteId) {
    return { success: false, error: "Couldn't create the note. Please try again." };
  }

  // Phase 7: index the note for semantic search once the response has
  // been sent (after(), not awaited here) — a fresh note usually has
  // no content yet (see app/(dashboard)/notes/new), but can arrive
  // with some already (e.g. a future import/duplicate feature), and
  // reindexNoteEmbedding no-ops cheaply on empty content either way.
  // A Gemini/database failure inside it is caught internally and can
  // never fail note creation — see lib/ai/embeddings.ts.
  after(() => reindexNoteEmbedding(noteId));

  revalidatePath("/dashboard");
  revalidatePath("/notes");
  revalidatePath("/favorites");
  revalidatePath("/tags");

  return { success: true, data: { id: noteId } };
}

export async function updateNote(
  noteId: string,
  input: UpdateNoteInput,
): Promise<ActionResult<{ updatedAt: string }>> {
  const parsed = updateNoteSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid note." };
  }

  const { supabase } = await requireUser();

  const { data, error } = await supabase
    .from("notes")
    .update({ title: parsed.data.title, content: parsed.data.content })
    .eq("id", noteId)
    .select("updated_at")
    .maybeSingle();

  // A zero-row result means RLS silently blocked the write — either the
  // id doesn't exist or belongs to someone else. Both map to the same
  // user-facing message, on purpose (see getNoteById for why).
  if (error || !data) {
    return { success: false, error: "This note couldn't be saved. It may have been deleted." };
  }

  // Phase 7.2: invalidating a previously-'ready' embedding on a
  // title/content change now happens inside the database itself, via
  // the bump_note_content_version trigger (migration 0008) — as part of
  // this same UPDATE statement, not a second one issued afterward. That
  // trigger also bumps notes.content_version, which is what lets
  // commit_note_embedding()/confirm_note_embedding_ready() atomically
  // reject a write from a reindex job that started against an older
  // version (see lib/ai/reindex-coordinator.ts). A separate follow-up
  // UPDATE here would just reintroduce a smaller instance of that same
  // race, so there's deliberately no app-level embedding_status write
  // in this function anymore.

  // Regenerate the embedding after this response is sent (after(), not
  // awaited) so autosave latency is unaffected by an extra Gemini call,
  // and so a failure there can never fail this save — see
  // lib/ai/embeddings.ts. Client-side, runSave (components/notes/
  // note-editor.tsx) only calls this action when title/content actually
  // changed, so this never fires on a no-op save.
  after(() => reindexNoteEmbedding(noteId));

  revalidatePath("/dashboard");
  revalidatePath("/notes");
  revalidatePath(`/notes/${noteId}`);

  return { success: true, data: { updatedAt: data.updated_at } };
}

export async function setFavorite(noteId: string, isFavorite: boolean): Promise<ActionResult> {
  const { supabase } = await requireUser();

  const { data, error } = await supabase
    .from("notes")
    .update({ is_favorite: isFavorite })
    .eq("id", noteId)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    return { success: false, error: "Couldn't update favorite status." };
  }

  revalidatePath("/dashboard");
  revalidatePath("/notes");
  revalidatePath("/favorites");
  revalidatePath(`/notes/${noteId}`);

  return { success: true };
}

export async function deleteNote(noteId: string): Promise<ActionResult> {
  const { supabase } = await requireUser();

  // note_tags and note_embeddings rows for this note are removed
  // automatically by the ON DELETE CASCADE foreign keys defined in
  // migration 0001 — no manual cleanup needed here.
  const { data, error } = await supabase
    .from("notes")
    .delete()
    .eq("id", noteId)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    return { success: false, error: "Couldn't delete this note. It may already be gone." };
  }

  revalidatePath("/dashboard");
  revalidatePath("/notes");
  revalidatePath("/favorites");
  revalidatePath("/tags");

  return { success: true };
}

export async function addTagToNote(
  noteId: string,
  tagName: string,
): Promise<ActionResult<{ id: string; name: string }>> {
  const { supabase } = await requireUser();

  // Confirm the note exists and belongs to the caller before attaching
  // anything to it — RLS would also block the note_tags insert below if
  // not, but checking here lets us return a clear message instead of a
  // generic failure.
  const { data: note } = await supabase
    .from("notes")
    .select("id")
    .eq("id", noteId)
    .maybeSingle();
  if (!note) {
    return { success: false, error: "Note not found." };
  }

  const tag = await getOrCreateTagId(supabase, tagName);
  if ("error" in tag) {
    return { success: false, error: tag.error };
  }

  const { error } = await supabase
    .from("note_tags")
    .insert({ note_id: noteId, tag_id: tag.id });

  // 23505 here means the note already has this tag — treat as success
  // rather than an error, since the end state the user wanted (tag
  // attached) is already true.
  if (error && error.code !== "23505") {
    return { success: false, error: "Couldn't add tag." };
  }

  revalidatePath(`/notes/${noteId}`);
  revalidatePath("/notes");
  revalidatePath("/tags");

  return { success: true, data: tag };
}

export async function removeTagFromNote(noteId: string, tagId: string): Promise<ActionResult> {
  const { supabase } = await requireUser();

  const { error } = await supabase
    .from("note_tags")
    .delete()
    .eq("note_id", noteId)
    .eq("tag_id", tagId);

  if (error) {
    return { success: false, error: "Couldn't remove tag." };
  }

  revalidatePath(`/notes/${noteId}`);
  revalidatePath("/notes");
  revalidatePath("/tags");

  return { success: true };
}
