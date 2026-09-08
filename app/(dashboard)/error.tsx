"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { EmptyState } from "@/components/notes/empty-state";
import { Button } from "@/components/ui/button";

/**
 * Shared error boundary for every route under the `(dashboard)` group
 * that doesn't already have a more specific one — dashboard, notes
 * list, favorites, tags, settings, and assistant. All of these render
 * a Server Component that does a real Supabase read (`getDashboardStats`,
 * `listNotes`, `listTagsWithCounts`, etc.) with nothing in between them
 * and the root layout to catch a thrown error, so a Supabase outage,
 * network blip, or unexpected query failure on any of them fell through
 * to Next.js's generic, unstyled default error screen before Phase 9.
 *
 * The note detail/editor route keeps its own specialized
 * `notes/[id]/error.tsx` (it also needs `not-found.tsx` for "note
 * doesn't exist / isn't yours"), so this file is never rendered there —
 * Next.js always picks the closest error boundary in the tree. That's
 * deliberate isolation per Phase 9 section 1: one boundary shared by the
 * routes that don't need anything more specific, rather than one nearly
 * identical error.tsx duplicated into six folders.
 *
 * Like the note-detail error boundary, this never renders `error.message`
 * — a thrown Supabase/Postgres error can contain raw query or connection
 * details that shouldn't reach the browser.
 */
export default function DashboardSegmentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Logged client-side only — never surfaced to the user, who just
    // sees the friendly retry state below.
    console.error(error);
  }, [error]);

  return (
    <EmptyState
      className="mt-6"
      icon={AlertTriangle}
      title="Something went wrong"
      description="We couldn't load this page. This is usually temporary — please try again."
      action={
        <Button className="mt-2" onClick={reset}>
          Try again
        </Button>
      }
    />
  );
}
