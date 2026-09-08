import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Note, Tag } from "@/types/database";
import type { NoteWithTags, NotesFilter, TagWithCount } from "@/lib/notes/types";

/**
 * Read-side data access for the notes product. Every function here
 * assumes it's called from a Server Component (or a Server Action) and
 * uses the cookie-scoped Supabase client from lib/supabase/server —
 * meaning every query is already RLS-scoped to whichever user is
 * signed in. There is no user_id parameter anywhere in this file: the
 * database, not application code, decides what a caller can see.
 */

async function requireUserId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("Not authenticated.");
  }
  return { supabase, userId: user.id };
}

/** Attaches tags to a batch of notes with a single extra query, instead of one query per note. */
async function attachTags(
  supabase: Awaited<ReturnType<typeof createClient>>,
  notes: Note[],
): Promise<NoteWithTags[]> {
  if (notes.length === 0) return [];

  const noteIds = notes.map((n) => n.id);
  const { data: joins, error } = await supabase
    .from("note_tags")
    .select("note_id, tag:tags(id, name)")
    .in("note_id", noteIds);

  if (error) {
    // Tags failing to load shouldn't take down the whole notes list —
    // degrade to notes with no visible tags rather than an error page.
    return notes.map((note) => ({ ...note, tags: [] }));
  }

  const tagsByNote = new Map<string, Pick<Tag, "id" | "name">[]>();
  for (const row of joins ?? []) {
    // Supabase-js types this as an array when it can't statically prove
    // the join is one-to-one; at runtime `tag` is a single object here
    // since tags.id is the referenced primary key.
    const tag = (Array.isArray(row.tag) ? row.tag[0] : row.tag) as Pick<
      Tag,
      "id" | "name"
    > | null;
    if (!tag) continue;
    const list = tagsByNote.get(row.note_id) ?? [];
    list.push(tag);
    tagsByNote.set(row.note_id, list);
  }

  return notes.map((note) => ({
    ...note,
    tags: (tagsByNote.get(note.id) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
  }));
}

/**
 * Escapes a raw search term for safe use as an ILIKE pattern body (the
 * part between the `%...%` wildcards this module adds). Backslash is
 * escaped first — it's ILIKE's default escape character — so a literal
 * backslash in the search text can't accidentally escape the `%`/`_`
 * markers we add next and change what the pattern matches.
 */
function escapeLikePattern(term: string): string {
  return term.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export async function listNotes(filter: NotesFilter = {}): Promise<NoteWithTags[]> {
  const { supabase } = await requireUserId();

  let query = supabase.from("notes").select("*").order("updated_at", { ascending: false });

  if (filter.favoritesOnly) {
    query = query.eq("is_favorite", true);
  }

  if (filter.query && filter.query.trim().length > 0) {
    // Search runs through the search_note_ids() RPC (migration 0005)
    // rather than a client-built `.or()` filter string. PostgREST's
    // filter grammar uses `,` to separate conditions, `.` to separate
    // column/operator/value, and `()` to group — none of which the
    // previous implementation escaped, so a comma or parenthesis in
    // the search box could append extra filter conditions and change
    // what the query matched. Passing the pattern as an RPC argument
    // sends it as a plain value in the request body, never as text
    // spliced into filter grammar, so there's no grammar left to break
    // out of.
    const pattern = `%${escapeLikePattern(filter.query.trim())}%`;
    const { data: matches, error: searchError } = await supabase.rpc("search_note_ids", {
      search_pattern: pattern,
    });
    if (searchError) throw new Error("Couldn't search notes.");

    const matchedIds = (matches ?? []).map((row) => row.note_id);
    if (matchedIds.length === 0) return [];
    query = query.in("id", matchedIds);
  }

  if (filter.tagId) {
    const { data: taggedRows, error: tagError } = await supabase
      .from("note_tags")
      .select("note_id")
      .eq("tag_id", filter.tagId);

    if (tagError) throw new Error("Couldn't load notes for this tag.");

    const noteIds = (taggedRows ?? []).map((r) => r.note_id);
    if (noteIds.length === 0) return [];
    query = query.in("id", noteIds);
  }

  if (filter.limit) {
    query = query.limit(filter.limit);
  }

  const { data, error } = await query;
  if (error) throw new Error("Couldn't load notes.");

  return attachTags(supabase, data ?? []);
}

export async function getNoteById(id: string): Promise<NoteWithTags | null> {
  const { supabase } = await requireUserId();

  const { data: note, error } = await supabase
    .from("notes")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  // RLS makes "exists but belongs to someone else" and "doesn't exist"
  // indistinguishable at the query level (both come back as no row) —
  // which is the correct, safe behavior: a not-found page never
  // confirms or denies that another user's note exists at that id.
  if (error || !note) return null;

  const [withTags] = await attachTags(supabase, [note]);
  return withTags;
}

export interface DashboardStats {
  totalNotes: number;
  favoriteCount: number;
  recentCount: number;
  recentNotes: NoteWithTags[];
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const { supabase } = await requireUserId();

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [totalRes, favoriteRes, recentCountRes, recentNotesRes] = await Promise.all([
    supabase.from("notes").select("id", { count: "exact", head: true }),
    supabase
      .from("notes")
      .select("id", { count: "exact", head: true })
      .eq("is_favorite", true),
    supabase
      .from("notes")
      .select("id", { count: "exact", head: true })
      .gte("created_at", sevenDaysAgo),
    supabase
      .from("notes")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(5),
  ]);

  if (totalRes.error || favoriteRes.error || recentCountRes.error || recentNotesRes.error) {
    throw new Error("Couldn't load dashboard stats.");
  }

  return {
    totalNotes: totalRes.count ?? 0,
    favoriteCount: favoriteRes.count ?? 0,
    recentCount: recentCountRes.count ?? 0,
    recentNotes: await attachTags(supabase, recentNotesRes.data ?? []),
  };
}

export async function listTagsWithCounts(): Promise<TagWithCount[]> {
  const { supabase } = await requireUserId();

  const { data, error } = await supabase
    .from("tags")
    .select("*, note_tags(count)")
    .order("name", { ascending: true });

  if (error) throw new Error("Couldn't load tags.");

  return (data ?? []).map((row) => {
    // PostgREST returns the aggregate as note_tags: [{ count: N }].
    const countRow = Array.isArray(row.note_tags) ? row.note_tags[0] : row.note_tags;
    const noteCount = (countRow as { count?: number } | null)?.count ?? 0;
    return {
      id: row.id,
      user_id: row.user_id,
      name: row.name,
      created_at: row.created_at,
      noteCount,
    };
  });
}

export async function getTagById(id: string): Promise<Tag | null> {
  const { supabase } = await requireUserId();
  const { data, error } = await supabase.from("tags").select("*").eq("id", id).maybeSingle();
  if (error || !data) return null;
  return data;
}
