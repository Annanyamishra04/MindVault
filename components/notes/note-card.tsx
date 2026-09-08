"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Star } from "lucide-react";
import { toast } from "sonner";
import { setFavorite } from "@/lib/notes/actions";
import { notePreview, relativeUpdated } from "@/lib/notes/format";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { NoteWithTags } from "@/lib/notes/types";

export function NoteCard({ note }: { note: NoteWithTags }) {
  // Local optimistic copy of favorite state: flips instantly on click,
  // rolls back if the server action reports failure.
  const [isFavorite, setIsFavorite] = useState(note.is_favorite);
  const [isPending, startTransition] = useTransition();

  function handleToggleFavorite(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const next = !isFavorite;
    setIsFavorite(next);
    startTransition(async () => {
      const result = await setFavorite(note.id, next);
      if (!result.success) {
        setIsFavorite(!next);
        toast.error(result.error);
      }
    });
  }

  return (
    <Link href={`/notes/${note.id}`} className="block">
      <Card className="h-full gap-3 p-5 transition-colors hover:border-foreground/20">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-1 font-serif text-base font-medium">{note.title}</h3>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 -mr-1 -mt-1"
            onClick={handleToggleFavorite}
            disabled={isPending}
            aria-pressed={isFavorite}
            aria-label={isFavorite ? "Unfavorite note" : "Favorite note"}
          >
            <Star
              className={cn(
                "size-4 transition-colors",
                isFavorite ? "fill-accent text-accent" : "text-muted-foreground",
              )}
            />
          </Button>
        </div>

        {note.content.trim() ? (
          <p className="line-clamp-2 text-sm text-muted-foreground">
            {notePreview(note.content)}
          </p>
        ) : (
          <p className="text-sm italic text-muted-foreground">No content yet</p>
        )}

        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="flex flex-wrap gap-1.5">
            {note.tags.slice(0, 3).map((tag) => (
              <Badge key={tag.id} variant="secondary" className="font-normal">
                {tag.name}
              </Badge>
            ))}
            {note.tags.length > 3 && (
              <Badge variant="outline" className="font-normal">
                +{note.tags.length - 3}
              </Badge>
            )}
          </div>
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {relativeUpdated(note.updated_at)}
          </span>
        </div>
      </Card>
    </Link>
  );
}
