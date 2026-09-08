import { notFound } from "next/navigation";
import { getNoteById } from "@/lib/notes/queries";
import { NoteEditor } from "@/components/notes/note-editor";

export default async function NoteDetailPage({ params }: PageProps<"/notes/[id]">) {
  const { id } = await params;

  const note = await getNoteById(id);

  // Covers both "no note with this id" and "a note exists but belongs
  // to someone else" — see getNoteById for why those are intentionally
  // indistinguishable here.
  if (!note) {
    notFound();
  }

  return <NoteEditor note={note} />;
}
