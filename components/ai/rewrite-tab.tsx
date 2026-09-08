"use client";

import { useState, useTransition } from "react";
import { Loader2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { rewriteNoteContent } from "@/lib/ai/actions";
import { rewriteModeLabels, type RewriteMode } from "@/lib/ai/schemas";
import { Button } from "@/components/ui/button";
import { AIError } from "@/components/ai/ai-error";
import { cn } from "@/lib/utils";

const MODES: RewriteMode[] = ["improve", "concise", "professional"];

export function RewriteTab({
  noteId,
  disabled,
  ensureSaved,
  onApplyRewrite,
}: {
  noteId: string;
  disabled: boolean;
  ensureSaved: () => Promise<{ ok: true } | { ok: false; error: string }>;
  onApplyRewrite: (content: string) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [mode, setMode] = useState<RewriteMode>("improve");
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isApplying, setIsApplying] = useState(false);

  function handleGenerate() {
    if (isPending) return;
    setError(null);
    setPreview(null);
    startTransition(async () => {
      const saveResult = await ensureSaved();
      if (!saveResult.ok) {
        setError(saveResult.error);
        return;
      }
      const result = await rewriteNoteContent(noteId, mode);
      if (result.success) {
        setPreview(result.data.rewritten);
      } else {
        setError(result.error);
      }
    });
  }

  async function handleApply() {
    if (!preview || isApplying) return;
    setIsApplying(true);
    const outcome = await onApplyRewrite(preview);
    setIsApplying(false);
    if (outcome.ok) {
      setPreview(null);
      toast.success("Rewrite applied and saved.");
    } else {
      // The rewrite is already showing in the editor (applying always
      // updates local state), but persisting it failed — surface that
      // clearly rather than implying it's safely saved. The editor's
      // own save-status/"Retry save" affordance (top of the page)
      // covers retrying; the preview stays open here so the text isn't
      // lost from view either way.
      toast.error(outcome.error ?? "Applied, but couldn't save. Use \"Retry save\" above.");
    }
  }

  function handleDiscard() {
    setPreview(null);
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Choose how to rewrite this note, then review the result before it replaces anything.
      </p>

      <div className="flex flex-wrap gap-1.5">
        {MODES.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            disabled={isPending}
            aria-pressed={mode === m}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50",
              mode === m
                ? "border-transparent bg-primary text-primary-foreground"
                : "border-input bg-background hover:bg-secondary",
            )}
          >
            {rewriteModeLabels[m]}
          </button>
        ))}
      </div>

      <div>
        <Button
          size="sm"
          variant="secondary"
          onClick={handleGenerate}
          disabled={disabled || isPending}
          className="gap-1.5"
        >
          {isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Wand2 className="size-3.5" />
          )}
          {isPending ? "Rewriting…" : preview ? "Regenerate" : "Generate rewrite"}
        </Button>
      </div>

      {error && <AIError message={error} />}

      {preview && !isPending && (
        <div className="flex flex-col gap-3 rounded-md border bg-secondary/40 p-3">
          <p className="text-xs font-medium text-muted-foreground">Preview — not saved yet</p>
          <p className="max-h-64 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed">
            {preview}
          </p>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={handleDiscard} disabled={isApplying}>
              Discard
            </Button>
            <Button size="sm" onClick={handleApply} disabled={isApplying}>
              {isApplying ? "Applying…" : "Apply rewrite"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
