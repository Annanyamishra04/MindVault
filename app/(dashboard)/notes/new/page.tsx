import { NewNoteForm } from "@/components/notes/new-note-form";

export default function NewNotePage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-serif text-2xl font-medium">New Note</h1>
      <NewNoteForm />
    </div>
  );
}
