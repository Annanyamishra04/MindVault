import Link from "next/link";
import { Tag as TagIcon } from "lucide-react";
import { listTagsWithCounts } from "@/lib/notes/queries";
import { EmptyState } from "@/components/notes/empty-state";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function TagsPage() {
  const tags = await listTagsWithCounts();

  if (tags.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="font-serif text-2xl font-medium">Tags</h1>
        <EmptyState
          icon={TagIcon}
          title="Organize your notes with tags."
          description="Add tags to a note from its editor, and they'll show up here for quick browsing."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-serif text-2xl font-medium">Tags</h1>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tags.map((tag) => (
          <Link key={tag.id} href={`/notes?tag=${tag.id}`}>
            <Card className="flex-row items-center justify-between gap-3 p-4 transition-colors hover:border-foreground/20">
              <div className="flex items-center gap-2.5">
                <TagIcon className="size-4 text-muted-foreground" />
                <span className="font-medium">{tag.name}</span>
              </div>
              <Badge variant="secondary" className="font-normal">
                {tag.noteCount} {tag.noteCount === 1 ? "note" : "notes"}
              </Badge>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
