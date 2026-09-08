"use client";

import { useRef, useState, useTransition, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Star, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { createNote } from "@/lib/notes/actions";
import { createNoteSchema, fieldErrors } from "@/lib/validation/notes";
import { useKeyboardShortcut } from "@/lib/hooks/use-keyboard-shortcut";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

export function NewNoteForm() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [isFavorite, setIsFavorite] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();

  function addTagFromDraft() {
    const name = tagDraft.trim();
    if (!name) return;
    if (tags.some((t) => t.toLowerCase() === name.toLowerCase())) {
      setTagDraft("");
      return;
    }
    setTags((prev) => [...prev, name]);
    setTagDraft("");
  }

  function handleTagKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTagFromDraft();
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isPending) return;

    const parsed = createNoteSchema.safeParse({ title, content, isFavorite, tags });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});

    startTransition(async () => {
      const result = await createNote(parsed.data);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Note created.");
      router.push(`/notes/${result.data.id}`);
      router.refresh();
    });
  }

  // Cmd/Ctrl+S creates the note, mirroring the "save" shortcut in the
  // note editor so the muscle memory carries over even though this is
  // technically a create rather than an update.
  useKeyboardShortcut("s", () => formRef.current?.requestSubmit(), {
    mod: true,
    allowInTypingContext: true,
  });

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      noValidate
      className="mx-auto flex w-full max-w-3xl flex-col gap-6"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor="new-note-title" className="sr-only">
            Title
          </Label>
          <Input
            id="new-note-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Note title"
            aria-invalid={!!errors.title}
            aria-describedby={errors.title ? "new-note-title-error" : undefined}
            className="h-auto border-none bg-transparent px-0 font-serif text-2xl font-medium shadow-none focus-visible:ring-0"
            autoFocus
          />
          {errors.title && (
            <p id="new-note-title-error" role="alert" className="text-xs text-destructive">
              {errors.title}
            </p>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setIsFavorite((f) => !f)}
          aria-pressed={isFavorite}
          aria-label={isFavorite ? "Unmark as favorite" : "Mark as favorite"}
        >
          <Star
            className={cn(
              "size-5 transition-colors",
              isFavorite ? "fill-accent text-accent" : "text-muted-foreground",
            )}
          />
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <Label className="text-xs font-medium text-muted-foreground">Tags</Label>
        <div className="flex flex-wrap items-center gap-1.5">
          {tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="gap-1 py-1 pl-2.5 pr-1.5 font-normal">
              {tag}
              <button
                type="button"
                onClick={() => setTags((prev) => prev.filter((t) => t !== tag))}
                aria-label={`Remove tag ${tag}`}
                className="rounded-full p-0.5 hover:bg-black/10"
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
          <Input
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={handleTagKeyDown}
            onBlur={addTagFromDraft}
            placeholder="Add a tag…"
            aria-label="Add a tag"
            className="h-7 w-32 px-2 text-xs"
          />
        </div>
        {errors.tags && (
          <p role="alert" className="text-xs text-destructive">
            {errors.tags}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="new-note-content" className="sr-only">
          Content
        </Label>
        <Textarea
          id="new-note-content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Start writing…"
          className="min-h-[45vh] resize-y border-none bg-transparent px-0 font-serif text-base leading-relaxed shadow-none focus-visible:ring-0"
        />
      </div>

      <div className="flex justify-end gap-2 border-t pt-4">
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={isPending}>
          Cancel
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Creating…
            </>
          ) : (
            "Create note"
          )}
        </Button>
      </div>
    </form>
  );
}
