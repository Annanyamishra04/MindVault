import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { EmptyState } from "@/components/notes/empty-state";
import { Button } from "@/components/ui/button";

export default function NoteNotFound() {
  return (
    <EmptyState
      icon={FileQuestion}
      title="Note not found"
      description="This note doesn't exist, or you don't have access to it."
      action={
        <Button asChild className="mt-2">
          <Link href="/notes">Back to all notes</Link>
        </Button>
      }
    />
  );
}
