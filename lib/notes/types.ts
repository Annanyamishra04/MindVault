import type { Note, Tag } from "@/types/database";

/** A note along with the tags attached to it, in a shape the UI can render directly. */
export type NoteWithTags = Note & {
  tags: Pick<Tag, "id" | "name">[];
};

/** A tag along with how many of the current user's notes use it. */
export type TagWithCount = Tag & {
  noteCount: number;
};

/** Filters accepted by the notes list query (dashboard, /notes, /favorites, /tags/[id] all funnel through this). */
export interface NotesFilter {
  query?: string;
  tagId?: string;
  favoritesOnly?: boolean;
  limit?: number;
}
