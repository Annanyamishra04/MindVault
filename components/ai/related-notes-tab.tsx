"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Loader2, Network, RefreshCw } from "lucide-react";
import { getRelatedNotes, reindexNote } from "@/lib/ai/actions";
import type { NormalizedMatch } from "@/lib/ai/semantic-normalize";
import { Button } from "@/components/ui/button";
import { AIError } from "@/components/ai/ai-error";

type PanelState =
  | { kind: "idle" }
  | { kind: "results"; results: NormalizedMatch[] }
  | { kind: "indexing" }
  | { kind: "too_large" }
  | { kind: "unavailable" }
  | { kind: "error"; message: string };

/**
 * Related Notes (Phase 7): vector similarity only — no AI-generated
 * explanations of *why* notes are related, no RAG, no summarization
 * across the results (see README, Phase 7 scope). Just "these notes
 * are semantically close to this one," ranked by similarity.
 *
 * Manual-trigger, like the other AIPanel tabs (Summary/Key
 * Points/Tags/Rewrite) — nothing here calls the database or a provider
 * just because the user opened the tab.
 */
export function RelatedNotesTab({
  noteId,
  ensureSaved,
}: {
  noteId: string;
  ensureSaved: () => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [state, setState] = useState<PanelState>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();
  const [isReindexing, startReindexTransition] = useTransition();

  function handleFind() {
    if (isPending) return;
    startTransition(async () => {
      const saveResult = await ensureSaved();
      if (!saveResult.ok) {
        setState({ kind: "error", message: saveResult.error });
        return;
      }

      const result = await getRelatedNotes(noteId);
      if (!result.success) {
        setState({ kind: "error", message: result.error });
        return;
      }

      switch (result.data.status) {
        case "ready":
          setState({ kind: "results", results: result.data.results });
          break;
        case "indexing":
          setState({ kind: "indexing" });
          break;
        case "too_large":
          setState({ kind: "too_large" });
          break;
        case "unavailable":
          setState({ kind: "unavailable" });
          break;
      }
    });
  }

  function handleReindex() {
    if (isReindexing) return;
    startReindexTransition(async () => {
      const result = await reindexNote(noteId);
      if (!result.success) {
        setState({ kind: "error", message: result.error });
        return;
      }
      handleFind();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Other notes of yours that are semantically similar to this one.
        </p>
        <Button
          size="sm"
          variant="secondary"
          onClick={handleFind}
          disabled={isPending}
          className="shrink-0 gap-1.5"
        >
          {isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Network className="size-3.5" />
          )}
          {isPending ? "Finding…" : state.kind === "results" ? "Refresh" : "Find related notes"}
        </Button>
      </div>

      {state.kind === "error" && <AIError message={state.message} />}

      {state.kind === "indexing" && !isPending && (
        <p className="text-sm text-muted-foreground">
          Note indexing still in progress — try again in a moment.
        </p>
      )}

      {state.kind === "too_large" && !isPending && (
        <p className="text-sm text-muted-foreground">
          This note is too large for semantic indexing right now, so related notes aren&apos;t
          available for it.
        </p>
      )}

      {state.kind === "unavailable" && !isPending && (
        <div className="flex items-center justify-between gap-2 rounded-md border bg-secondary/40 p-3">
          <p className="text-sm text-muted-foreground">
            Semantic index unavailable for this note yet.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={handleReindex}
            disabled={isReindexing}
            className="shrink-0 gap-1.5"
          >
            {isReindexing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            Retry
          </Button>
        </div>
      )}

      {state.kind === "results" && !isPending && state.results.length === 0 && (
        <p className="text-sm text-muted-foreground">No related notes found.</p>
      )}

      {state.kind === "results" && !isPending && state.results.length > 0 && (
        <ul className="flex flex-col divide-y rounded-md border">
          {state.results.map((r) => (
            <li key={r.noteId} className="px-3 py-2.5">
              <Link href={`/notes/${r.noteId}`} className="group flex flex-col gap-0.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-serif text-sm font-medium group-hover:underline">
                    {r.title}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {r.similarityPercent}% match
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
