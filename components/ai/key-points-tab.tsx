"use client";

import { useState, useTransition } from "react";
import { ListChecks, Loader2 } from "lucide-react";
import { extractKeyPoints } from "@/lib/ai/actions";
import { Button } from "@/components/ui/button";
import { AIError } from "@/components/ai/ai-error";

export function KeyPointsTab({
  noteId,
  disabled,
  ensureSaved,
}: {
  noteId: string;
  disabled: boolean;
  ensureSaved: () => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [keyPoints, setKeyPoints] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleGenerate() {
    if (isPending) return;
    setError(null);
    startTransition(async () => {
      const saveResult = await ensureSaved();
      if (!saveResult.ok) {
        setError(saveResult.error);
        return;
      }
      const result = await extractKeyPoints(noteId);
      if (result.success) {
        setKeyPoints(result.data.keyPoints);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          The main takeaways from this note, extracted by AI.
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
            <ListChecks className="size-3.5" />
          )}
          {isPending ? "Extracting…" : keyPoints ? "Regenerate" : "Extract key points"}
        </Button>
      </div>

      {error && <AIError message={error} />}

      {keyPoints && !isPending && (
        <ul className="flex flex-col gap-1.5 rounded-md border bg-secondary/40 p-3">
          {keyPoints.map((point, i) => (
            <li key={i} className="flex gap-2 text-sm leading-relaxed">
              <span className="mt-1 size-1 shrink-0 rounded-full bg-muted-foreground" />
              <span>{point}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
