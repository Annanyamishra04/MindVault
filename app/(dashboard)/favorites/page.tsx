import Link from "next/link";
import { Star, SearchX } from "lucide-react";
import { listNotes } from "@/lib/notes/queries";
import { sortNotes, parseSortOption } from "@/lib/notes/sort";
import { NotesGrid } from "@/components/notes/notes-grid";
import { SearchBar } from "@/components/notes/search-bar";
import { SortMenu } from "@/components/notes/sort-menu";
import { EmptyState } from "@/components/notes/empty-state";
import { Button } from "@/components/ui/button";

interface FavoritesPageProps {
  searchParams: Promise<{ q?: string; sort?: string }>;
}

export default async function FavoritesPage({ searchParams }: FavoritesPageProps) {
  const { q, sort } = await searchParams;
  const notesRaw = await listNotes({ favoritesOnly: true, query: q });
  const notes = sortNotes(notesRaw, parseSortOption(sort));
  const isFiltered = Boolean(q?.trim());

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2.5">
          <h1 className="font-serif text-2xl font-medium">Favorites</h1>
          <span className="text-sm text-muted-foreground">
            {notes.length} {notes.length === 1 ? "note" : "notes"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SearchBar placeholder="Search favorites…" />
          <SortMenu />
        </div>
      </div>

      <NotesGrid
        notes={notes}
        emptyState={
          isFiltered ? (
            <EmptyState
              icon={SearchX}
              title="No notes match your search."
              description="Try a different keyword, or clear the filter to see all favorites."
              action={
                <Button asChild variant="outline" className="mt-2">
                  <Link href="/favorites">Clear search</Link>
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={Star}
              title="Favorite important notes to find them quickly."
              description="Tap the star on any note to pin it here."
              action={
                <Button asChild variant="outline" className="mt-2">
                  <Link href="/notes">Browse your notes</Link>
                </Button>
              }
            />
          )
        }
      />
    </div>
  );
}
