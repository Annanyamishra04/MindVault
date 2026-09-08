import { NoteCard } from "@/components/notes/note-card";
import type { NoteWithTags } from "@/lib/notes/types";
import type { ReactNode } from "react";

export function NotesGrid({
  notes,
  emptyState,
}: {
  notes: NoteWithTags[];
  emptyState: ReactNode;
}) {
  if (notes.length === 0) {
    return <>{emptyState}</>;
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {notes.map((note) => (
        <NoteCard key={note.id} note={note} />
      ))}
    </div>
  );
}
