import Link from "next/link";
import { PlusCircle, FileText, SearchX } from "lucide-react";
import { listNotes, getTagById } from "@/lib/notes/queries";
import { sortNotes, parseSortOption } from "@/lib/notes/sort";
import { NotesGrid } from "@/components/notes/notes-grid";
import { SearchBar } from "@/components/notes/search-bar";
import { SemanticSearchPanel } from "@/components/notes/semantic-search-panel";
import { SortMenu } from "@/components/notes/sort-menu";
import { ActiveTagFilter } from "@/components/notes/active-tag-filter";
import { EmptyState } from "@/components/notes/empty-state";
import { Button } from "@/components/ui/button";

interface NotesPageProps {
  searchParams: Promise<{ q?: string; tag?: string; sort?: string }>;
}

export default async function NotesPage({ searchParams }: NotesPageProps) {
  const { q, tag: tagId, sort } = await searchParams;

  const [notesRaw, activeTag] = await Promise.all([
    listNotes({ query: q, tagId }),
    tagId ? getTagById(tagId) : Promise.resolve(null),
  ]);

  const notes = sortNotes(notesRaw, parseSortOption(sort));
  const isFiltered = Boolean(q?.trim() || tagId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2.5">
          <h1 className="font-serif text-2xl font-medium">All Notes</h1>
          <span className="text-sm text-muted-foreground">
            {notes.length} {notes.length === 1 ? "note" : "notes"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SearchBar />
          <SortMenu />
          <Button asChild className="gap-2">
            <Link href="/notes/new">
              <PlusCircle className="size-4" />
              New Note
            </Link>
          </Button>
        </div>
      </div>

      {activeTag && (
        <div>
          <ActiveTagFilter tagName={activeTag.name} clearHref="/notes" />
        </div>
      )}

      <SemanticSearchPanel />

      <NotesGrid
        notes={notes}
        emptyState={
          isFiltered ? (
            <EmptyState
              icon={SearchX}
              title="No notes match your search."
              description="Try a different keyword, or clear the filter to see everything."
              action={
                <Button asChild variant="outline" className="mt-2">
                  <Link href="/notes">Clear filters</Link>
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={FileText}
              title="Start capturing your ideas."
              description="Every note you write lives here, searchable and organized with tags."
              action={
                <Button asChild className="mt-2 gap-2">
                  <Link href="/notes/new">
                    <PlusCircle className="size-4" />
                    Create your first note
                  </Link>
                </Button>
              }
            />
          )
        }
      />
    </div>
  );
}
