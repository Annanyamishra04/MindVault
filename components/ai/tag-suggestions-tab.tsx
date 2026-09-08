"use client";

import { useMemo, useState, useTransition } from "react";
import { Check, Loader2, Plus, Tag as TagIcon } from "lucide-react";
import { suggestNoteTags } from "@/lib/ai/actions";
import { Button } from "@/components/ui/button";
import { AIError } from "@/components/ai/ai-error";
import { cn } from "@/lib/utils";

interface TagSuggestionsTabProps {
  noteId: string;
  disabled: boolean;
  ensureSaved: () => Promise<{ ok: true } | { ok: false; error: string }>;
  existingTagNames: string[];
  onAcceptTag: (name: string) => Promise<{ success: boolean; error?: string }>;
}

export function TagSuggestionsTab({
  noteId,
  disabled,
  ensureSaved,
  existingTagNames,
  onAcceptTag,
}: TagSuggestionsTabProps) {
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addedNames, setAddedNames] = useState<Set<string>>(new Set());
  const [pendingName, setPendingName] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const existingLower = useMemo(
    () => new Set(existingTagNames.map((n) => n.toLowerCase())),
    [existingTagNames],
  );

  function handleGenerate() {
    if (isPending) return;
    setError(null);
    startTransition(async () => {
      const saveResult = await ensureSaved();
      if (!saveResult.ok) {
        setError(saveResult.error);
        return;
      }
      const result = await suggestNoteTags(noteId);
      if (result.success) {
        setSuggestions(result.data.tags);
        setAddedNames(new Set());
      } else {
        setError(result.error);
      }
    });
  }

  async function handleAccept(name: string) {
    setPendingName(name);
    const result = await onAcceptTag(name);
    setPendingName(null);
    if (result.success) {
      setAddedNames((prev) => new Set(prev).add(name));
    } else {
      setError(result.error ?? "Couldn't add that tag.");
    }
  }

  async function handleAcceptAll() {
    if (!suggestions) return;
    const toAdd = suggestions.filter(
      (name) => !existingLower.has(name.toLowerCase()) && !addedNames.has(name),
    );
    for (const name of toAdd) {
      // Sequential, not Promise.all: addTagToNote revalidates paths and
      // updates shared note state per call, and the existing TagEditor
      // component follows the same one-at-a-time convention.
      await handleAccept(name);
    }
  }

  const remainingCount =
    suggestions?.filter(
      (name) => !existingLower.has(name.toLowerCase()) && !addedNames.has(name),
    ).length ?? 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Tag suggestions based on this note&apos;s content. Nothing is added until you accept it.
        </p>
        <Button
          size="sm"
          variant="secondary"
          onClick={handleGenerate}
          disabled={disabled || isPending}
          className="shrink-0 gap-1.5"
        >
          {isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <TagIcon className="size-3.5" />
          )}
          {isPending ? "Finding tags…" : suggestions ? "Regenerate" : "Suggest tags"}
        </Button>
      </div>

      {error && <AIError message={error} />}

      {suggestions && !isPending && (
        <div className="flex flex-col gap-3 rounded-md border bg-secondary/40 p-3">
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((name) => {
              const alreadyOnNote = existingLower.has(name.toLowerCase());
              const added = addedNames.has(name);
              const isAdding = pendingName === name;
              const isDone = alreadyOnNote || added;
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => handleAccept(name)}
                  disabled={isDone || isAdding}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                    isDone
                      ? "cursor-default border-transparent bg-primary/10 text-primary"
                      : "border-input bg-background hover:bg-secondary",
                  )}
                >
                  {isAdding ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : isDone ? (
                    <Check className="size-3" />
                  ) : (
                    <Plus className="size-3" />
                  )}
                  {name}
                  {alreadyOnNote && !added && (
                    <span className="text-[10px] text-muted-foreground">already on note</span>
                  )}
                </button>
              );
            })}
          </div>
          {remainingCount > 1 && (
            <div className="flex justify-end">
              <Button size="sm" variant="outline" onClick={handleAcceptAll} className="h-7 text-xs">
                Add all {remainingCount} suggested tags
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
