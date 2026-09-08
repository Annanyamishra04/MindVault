"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { EmptyState } from "@/components/notes/empty-state";
import { Button } from "@/components/ui/button";

export default function NoteDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Logged client-side only — never surfaced to the user, who just
    // sees the friendly retry state below. Raw error details (stack
    // traces, DB error text) should never reach the UI.
    console.error(error);
  }, [error]);

  return (
    <EmptyState
      icon={AlertTriangle}
      title="Something went wrong"
      description="We couldn't load this note. Please try again."
      action={
        <Button className="mt-2" onClick={reset}>
          Try again
        </Button>
      }
    />
  );
}
