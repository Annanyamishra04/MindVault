"use client";

import { useState, useTransition, type KeyboardEvent } from "react";
import { X, Loader2, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

export interface EditableTag {
  id: string;
  name: string;
}

interface TagEditorProps {
  tags: EditableTag[];
  onAdd: (name: string) => Promise<{ success: boolean; error?: string }>;
  onRemove: (id: string) => Promise<{ success: boolean; error?: string }>;
  disabled?: boolean;
}

/**
 * A pill-style tag list with an inline "add tag" input. Both the new-note
 * form (tags held in local React state) and the note editor (tags backed
 * by note_tags rows via Server Actions) share this component — they just
 * pass different `onAdd`/`onRemove` implementations.
 */
export function TagEditor({ tags, onAdd, onRemove, disabled }: TagEditorProps) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isAdding, startAdding] = useTransition();
  const [removingId, setRemovingId] = useState<string | null>(null);

  function submitDraft() {
    const name = draft.trim();
    if (!name) return;
    if (tags.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
      setError("That tag is already on this note.");
      return;
    }
    setError(null);
    startAdding(async () => {
      const result = await onAdd(name);
      if (result.success) {
        setDraft("");
      } else {
        setError(result.error ?? "Couldn't add tag.");
      }
    });
  }

  function handleRemove(id: string) {
    setRemovingId(id);
    onRemove(id).finally(() => setRemovingId(null));
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      submitDraft();
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((tag) => (
          <Badge key={tag.id} variant="secondary" className="gap-1 py-1 pl-2.5 pr-1.5 font-normal">
            {tag.name}
            <button
              type="button"
              onClick={() => handleRemove(tag.id)}
              disabled={disabled || removingId === tag.id}
              aria-label={`Remove tag ${tag.name}`}
              className="rounded-full p-0.5 hover:bg-black/10 disabled:opacity-50"
            >
              {removingId === tag.id ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <X className="size-3" />
              )}
            </button>
          </Badge>
        ))}
        <div className="flex items-center gap-1">
          <Input
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Add a tag…"
            aria-label="Add a tag"
            disabled={disabled || isAdding}
            className="h-7 w-32 px-2 text-xs"
          />
          {isAdding && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
          {!isAdding && draft.trim() && (
            <button
              type="button"
              onClick={submitDraft}
              aria-label="Add tag"
              className="rounded-full p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <Plus className="size-3.5" />
            </button>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
