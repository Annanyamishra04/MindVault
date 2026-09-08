"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Loader2, Search, Sparkles } from "lucide-react";
import { askMyNotes, type AskSource } from "@/lib/ai/ask-actions";
import { MAX_ASK_QUESTION_CHARS } from "@/lib/ai/limits";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { AIError } from "@/components/ai/ai-error";

type AskState =
  | { kind: "idle" }
  | { kind: "answered"; answer: string; sources: AskSource[] }
  | { kind: "no_results" }
  | { kind: "unsupported" }
  | { kind: "index_unavailable" }
  | { kind: "answer_failed" }
  | { kind: "error"; message: string };

/**
 * "Ask My Notes" (Phase 8): a natural-language question over the
 * user's own notes, answered with Retrieval-Augmented Generation.
 *
 * Every submission is an independent request — there is no
 * conversational memory (see lib/ai/ask-actions.ts's module docstring)
 * — so a follow-up question re-runs retrieval from scratch rather than
 * building on the previous answer. This intentionally keeps retrieval
 * explicit rather than silently carrying hidden context between turns.
 */
export function AskPanel() {
  const [question, setQuestion] = useState("");
  const [state, setState] = useState<AskState>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isPending) return; // duplicate-submit protection while a request is in flight
    const trimmed = question.trim();
    if (!trimmed) return;

    startTransition(async () => {
      const result = await askMyNotes(trimmed);
      if (!result.success) {
        setState({ kind: "error", message: result.error });
        return;
      }
      switch (result.data.status) {
        case "answered":
          setState({ kind: "answered", answer: result.data.answer, sources: result.data.sources });
          break;
        case "no_results":
          setState({ kind: "no_results" });
          break;
        case "unsupported":
          setState({ kind: "unsupported" });
          break;
        case "index_unavailable":
          setState({ kind: "index_unavailable" });
          break;
        case "answer_failed":
          setState({ kind: "answer_failed" });
          break;
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <Textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value.slice(0, MAX_ASK_QUESTION_CHARS))}
            placeholder="Ask a question about your notes, e.g. “What did I decide about the Q3 roadmap?”"
            aria-label="Ask a question about your notes"
            rows={3}
            disabled={isPending}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {question.length}/{MAX_ASK_QUESTION_CHARS}
            </span>
            <Button type="submit" disabled={isPending || !question.trim()} className="gap-1.5">
              {isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
              {isPending ? "Thinking…" : "Ask"}
            </Button>
          </div>
        </form>
      </Card>

      {state.kind === "error" && (
        <Card className="p-4">
          <AIError message={state.message} />
        </Card>
      )}

      {state.kind === "no_results" && (
        <Card className="flex flex-col items-center gap-2 p-8 text-center">
          <Search className="size-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            I couldn&apos;t find relevant information in your notes to answer that.
          </p>
        </Card>
      )}

      {state.kind === "unsupported" && (
        <Card className="flex flex-col items-center gap-2 p-8 text-center">
          <Search className="size-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            I found related notes, but couldn&apos;t put together a confidently-sourced answer
            from them.
          </p>
        </Card>
      )}

      {state.kind === "index_unavailable" && (
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">
            Your semantic index is currently unavailable. Try again in a moment.
          </p>
        </Card>
      )}

      {state.kind === "answer_failed" && (
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">
            Relevant notes were found, but the answer could not be generated. Please try again.
          </p>
        </Card>
      )}

      {state.kind === "answered" && (
        <Card className="flex flex-col gap-4 p-5">
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{state.answer}</p>

          {state.sources.length > 0 && (
            <div className="flex flex-col gap-2 border-t pt-4">
              <p className="text-xs font-medium text-muted-foreground">Sources</p>
              <ul className="flex flex-col gap-2">
                {state.sources.map((source) => (
                  <li key={source.noteId}>
                    <Link
                      href={`/notes/${source.noteId}`}
                      className="group flex flex-col gap-0.5 rounded-md border p-3 transition-colors hover:bg-secondary/40"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-serif text-sm font-medium group-hover:underline">
                          {source.title}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {source.similarityPercent}% match
                        </span>
                      </div>
                      {source.excerpt && (
                        <p className="line-clamp-2 text-xs text-muted-foreground">
                          {source.excerpt}
                        </p>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
