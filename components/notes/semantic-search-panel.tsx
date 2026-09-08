"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import { semanticSearchNotes } from "@/lib/ai/actions";
import type { NormalizedMatch } from "@/lib/ai/semantic-normalize";
import { useDebouncedCallback } from "@/lib/hooks/use-debounced-callback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { MAX_SEMANTIC_QUERY_CHARS } from "@/lib/ai/limits";

/**
 * "Search by meaning" (Phase 7): an explicit, separate mode from the
 * keyword SearchBar above it on this page, per the spec's option C —
 * rather than a mode toggle on the same input, this keeps the existing
 * Phase 5 keyword search completely untouched (it keeps working
 * identically, including if this panel or Gemini is unavailable) and
 * adds semantic search as its own clearly-labeled, opt-in affordance.
 *
 * Deliberately does not share the SearchBar's query text or debounce
 * against typing: unlike keyword search, this triggers a real Gemini
 * API call + vector RPC per search, so it fires only on explicit
 * submission (Enter or the Search button), with a short debounce as a
 * guard against double-submits rather than as a type-ahead trigger.
 */
export function SemanticSearchPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NormalizedMatch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Guards against a duplicate in-flight request for the identical
  // query text (e.g. pressing Enter twice, or a debounce firing while
  // the previous identical search is still running) — see Phase 7
  // spec section 16.
  const lastRequestedQuery = useRef<string | null>(null);

  function runSearch(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (isPending && lastRequestedQuery.current === trimmed) return;

    lastRequestedQuery.current = trimmed;
    setError(null);
    startTransition(async () => {
      const result = await semanticSearchNotes(trimmed);
      setHasSearched(true);
      if (result.success) {
        setResults(result.data.results);
      } else {
        setResults([]);
        setError(result.error);
      }
    });
  }

  const debouncedSearch = useDebouncedCallback(runSearch, 400);

  function handleChange(value: string) {
    setQuery(value.slice(0, MAX_SEMANTIC_QUERY_CHARS));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    runSearch(query);
  }

  function handleClose() {
    setIsOpen(false);
    setQuery("");
    setResults([]);
    setError(null);
    setHasSearched(false);
    lastRequestedQuery.current = null;
  }

  if (!isOpen) {
    return (
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setIsOpen(true)}>
        <Sparkles className="size-4" />
        Search by meaning
      </Button>
    );
  }

  return (
    <Card className="w-full gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <Sparkles className="size-4 text-accent" />
          Search by meaning
        </p>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={handleClose}
          aria-label="Close semantic search"
        >
          <X className="size-3.5" />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Describe what you&apos;re looking for in your own words — results are ranked by meaning,
        not exact keyword matches. This doesn&apos;t replace the search box above; use whichever
        finds what you need.
      </p>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <Input
          value={query}
          onChange={(e) => {
            handleChange(e.target.value);
            debouncedSearch(e.target.value);
          }}
          placeholder='e.g. "React job preparation"'
          aria-label="Search notes by meaning"
          autoFocus
        />
        <Button type="submit" disabled={isPending || !query.trim()} className="shrink-0 gap-1.5">
          {isPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          Search
        </Button>
      </form>

      {isPending && <p className="text-sm text-muted-foreground">Searching by meaning…</p>}

      {!isPending && error && <p className="text-sm text-destructive">{error}</p>}

      {!isPending && !error && hasSearched && results.length === 0 && (
        <p className="text-sm text-muted-foreground">No semantically similar notes found.</p>
      )}

      {!isPending && results.length > 0 && (
        <ul className="flex flex-col divide-y">
          {results.map((r) => (
            <li key={r.noteId} className="py-2.5">
              <Link href={`/notes/${r.noteId}`} className="group flex flex-col gap-0.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-serif text-sm font-medium group-hover:underline">
                    {r.title}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {r.similarityPercent}% match
                  </span>
                </div>
                {r.snippet && (
                  <p className="line-clamp-1 text-xs text-muted-foreground">{r.snippet}</p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
