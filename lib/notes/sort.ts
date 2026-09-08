import type { NoteWithTags } from "@/lib/notes/types";

export const SORT_OPTIONS = ["updated", "created", "title"] as const;
export type SortOption = (typeof SORT_OPTIONS)[number];

export const SORT_LABELS: Record<SortOption, string> = {
  updated: "Last updated",
  created: "Date created",
  title: "Title",
};

export function parseSortOption(value: string | undefined): SortOption {
  return (SORT_OPTIONS as readonly string[]).includes(value ?? "")
    ? (value as SortOption)
    : "updated";
}

/**
 * Sorts an already-fetched notes list in place of a new query. The
 * notes list is fetched sorted by updated_at from the database (the
 * common case and the cheapest to index), so "updated" is a no-op;
 * the other two orderings are small in-memory re-sorts of a list
 * that's already page-sized, which is simpler and cheaper than adding
 * new query variants for something this small.
 */
export function sortNotes(notes: NoteWithTags[], sort: SortOption): NoteWithTags[] {
  if (sort === "updated") return notes;

  const sorted = [...notes];
  if (sort === "created") {
    sorted.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  } else if (sort === "title") {
    sorted.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
  }
  return sorted;
}
