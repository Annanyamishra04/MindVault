"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Sparkles, Star } from "lucide-react";
import { toast } from "sonner";
import { updateNote, setFavorite, addTagToNote, removeTagFromNote } from "@/lib/notes/actions";
import { useDebouncedCallback } from "@/lib/hooks/use-debounced-callback";
import { useKeyboardShortcut } from "@/lib/hooks/use-keyboard-shortcut";
import { relativeUpdated } from "@/lib/notes/format";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { TagEditor, type EditableTag } from "@/components/notes/tag-editor";
import { DeleteNoteDialog } from "@/components/notes/delete-note-dialog";
import { SaveStatus, type SaveState } from "@/components/notes/save-status";
import { AIPanel } from "@/components/ai/ai-panel";
import type { NoteWithTags } from "@/lib/notes/types";

const AUTOSAVE_DELAY_MS = 1200;

/**
 * Outcome of a save cycle, returned by `runSave`/`ensureSaved` so callers
 * (specifically AI actions) can tell "persisted" from "failed to
 * persist" without inferring it from `saveState`, which is React state
 * and therefore always at least one render behind the refs that
 * actually drive the save loop.
 */
type SaveOutcome = { ok: true } | { ok: false; error: string };

export function NoteEditor({ note }: { note: NoteWithTags }) {
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [tags, setTags] = useState<EditableTag[]>(note.tags);
  const [isFavorite, setIsFavorite] = useState(note.is_favorite);
  const [updatedAt, setUpdatedAt] = useState(note.updated_at);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [isFavoritePending, startFavoriteTransition] = useTransition();
  const [showAI, setShowAI] = useState(false);

  // Refs mirror the latest draft so the save loop below always reads
  // the newest text on each pass, never a value captured by a stale
  // closure from whenever the pass started.
  const titleRef = useRef(title);
  const contentRef = useRef(content);
  const savedRef = useRef({ title: note.title, content: note.content });
  const savingRef = useRef(false);
  const pendingRef = useRef(false);
  // Holds the Promise for whichever save cycle is currently in flight —
  // including any pending re-run it triggers via `pendingRef` — or null
  // when idle. This, not `saveState`, is the source of truth for "is a
  // save happening right now" and "what will it resolve to": state
  // updates are batched/async, but this ref is set synchronously the
  // instant `runSave` starts a new cycle (see `runSave` below), so a
  // caller can never read it mid-update and see a stale value.
  const savePromiseRef = useRef<Promise<SaveOutcome> | null>(null);

  useEffect(() => {
    titleRef.current = title;
  }, [title]);
  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  const runSave = useCallback((): Promise<SaveOutcome> => {
    if (savingRef.current) {
      // A save is already in flight — remember to run again once it
      // finishes, instead of firing a second overlapping request now.
      // Return the SAME promise the in-flight save is running under, so
      // this caller (and any other concurrent caller) awaits the whole
      // cycle: the current pass finishing AND the pending re-run this
      // call just requested, not just "some save started."
      pendingRef.current = true;
      return savePromiseRef.current ?? Promise.resolve({ ok: true });
    }

    savingRef.current = true;
    const promise = (async (): Promise<SaveOutcome> => {
      let outcome: SaveOutcome = { ok: true };
      try {
        // Loop rather than recurse: if the draft changes again while this
        // save is in flight (pendingRef gets set), fold that into another
        // pass of the same call instead of a second visible request.
        for (;;) {
          const nextTitle = titleRef.current;
          const nextContent = contentRef.current;

          if (nextTitle === savedRef.current.title && nextContent === savedRef.current.content) {
            break;
          }
          if (!nextTitle.trim()) {
            setSaveState("unsaved");
            // Not persisted — a caller waiting on this (e.g. an AI
            // action via ensureSaved) must not treat this as success.
            outcome = { ok: false, error: "Add a title before using AI tools on this note." };
            break;
          }

          setSaveState("saving");
          const result = await updateNote(note.id, { title: nextTitle, content: nextContent });

          if (result.success) {
            savedRef.current = { title: nextTitle, content: nextContent };
            setUpdatedAt(result.data.updatedAt);
            setSaveState("saved");
            outcome = { ok: true };
          } else {
            setSaveState("error");
            toast.error(result.error);
            outcome = { ok: false, error: result.error };
            break;
          }

          if (!pendingRef.current) break;
          pendingRef.current = false;
        }
      } finally {
        savingRef.current = false;
        savePromiseRef.current = null;
      }
      return outcome;
    })();

    savePromiseRef.current = promise;
    return promise;
  }, [note.id]);

  const debouncedSave = useDebouncedCallback(runSave, AUTOSAVE_DELAY_MS);

  /**
   * AI Server Actions (lib/ai/actions.ts) always load a note's content
   * from the database by id — they never trust content sent from the
   * browser (see that file for why). That means an AI action can only
   * ever see what's already saved, so every AI action calls this first
   * and must not proceed unless it resolves `{ ok: true }`.
   *
   * Deliberately does not branch on `saveState`: if a save is already
   * in flight, `saveState` is "saving" the whole time that save runs,
   * so checking it can't tell a caller anything about whether THIS
   * specific edit has landed yet — only `savePromiseRef` (and, after
   * that settles, a direct ref comparison) can.
   *
   *   1. If a save is in flight, await the exact promise it's running
   *      under — which also covers any pending re-run triggered by an
   *      edit that arrived while it was in flight (see `runSave`).
   *   2. If that save failed, stop here and report the failure — never
   *      let an AI action fall through to reading stale/error-state
   *      content from the database.
   *   3. Otherwise, compare the live refs (not React state) for
   *      anything still unsaved — including an edit that landed in the
   *      instant between step 1 resolving and this check — and, if so,
   *      run and await a fresh save.
   */
  const ensureSaved = useCallback(async (): Promise<SaveOutcome> => {
    if (savePromiseRef.current) {
      const outcome = await savePromiseRef.current;
      if (!outcome.ok) return outcome;
    }

    if (titleRef.current !== savedRef.current.title || contentRef.current !== savedRef.current.content) {
      return runSave();
    }

    return { ok: true };
  }, [runSave]);

  /**
   * Applying an AI rewrite goes through the exact same `runSave` path
   * as a manual save or Cmd/Ctrl+S — not a separate write — so it
   * shares the same in-flight/pending guard as autosave. Concretely:
   * if autosave is already saving the pre-rewrite draft when the user
   * clicks Apply, `contentRef` is updated first so that in-flight save
   * finishes, notices `pendingRef`, and immediately runs again with the
   * rewritten text — the newest, user-approved content always wins,
   * never an older draft racing in after it. The caller (RewriteTab)
   * awaits the returned outcome so it can tell the user if the
   * rewrite's *save* failed, even though applying it to the editor
   * itself always succeeds.
   */
  const handleApplyRewrite = useCallback(
    (newContent: string): Promise<SaveOutcome> => {
      contentRef.current = newContent;
      setContent(newContent);
      setSaveState("unsaved");
      return runSave();
    },
    [runSave],
  );

  function handleTitleChange(value: string) {
    setTitle(value);
    setSaveState("unsaved");
    debouncedSave();
  }

  function handleContentChange(value: string) {
    setContent(value);
    setSaveState("unsaved");
    debouncedSave();
  }

  function handleManualSave() {
    runSave();
  }

  // Cmd/Ctrl+S saves immediately instead of waiting for the autosave
  // debounce. allowInTypingContext is required here since the whole
  // point is to save while the cursor is still in the title/content
  // field — unlike most shortcuts, this one must work while typing.
  useKeyboardShortcut("s", handleManualSave, { mod: true, allowInTypingContext: true });

  // Warn before leaving the tab with unsaved edits — text lives only in
  // component state until a save succeeds, so a stray close/reload
  // could otherwise lose it silently.
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (saveState === "unsaved" || saveState === "saving") {
        e.preventDefault();
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [saveState]);

  function handleToggleFavorite() {
    const next = !isFavorite;
    setIsFavorite(next);
    startFavoriteTransition(async () => {
      const result = await setFavorite(note.id, next);
      if (!result.success) {
        setIsFavorite(!next);
        toast.error(result.error);
      }
    });
  }

  async function handleAddTag(name: string) {
    const result = await addTagToNote(note.id, name);
    if (result.success) {
      setTags((prev) => [...prev, result.data].sort((a, b) => a.name.localeCompare(b.name)));
    }
    return result;
  }

  async function handleRemoveTag(tagId: string) {
    const previous = tags;
    setTags((prev) => prev.filter((t) => t.id !== tagId));
    const result = await removeTagFromNote(note.id, tagId);
    if (!result.success) {
      setTags(previous);
      toast.error(result.error);
    }
    return result;
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SaveStatus state={saveState} />
        <div className="flex items-center gap-2">
          {saveState === "error" && (
            <Button size="sm" variant="outline" onClick={handleManualSave}>
              Retry save
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={handleToggleFavorite}
            disabled={isFavoritePending}
            aria-pressed={isFavorite}
            aria-label={isFavorite ? "Unfavorite note" : "Favorite note"}
          >
            <Star
              className={cn(
                "size-5 transition-colors",
                isFavorite ? "fill-accent text-accent" : "text-muted-foreground",
              )}
            />
          </Button>
          <Button
            variant={showAI ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setShowAI((prev) => !prev)}
            aria-pressed={showAI}
            className="gap-1.5"
          >
            <Sparkles className="size-4" />
            AI Tools
          </Button>
          <DeleteNoteDialog noteId={note.id} noteTitle={title} />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="note-title" className="sr-only">
          Title
        </Label>
        <Input
          id="note-title"
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          onBlur={handleManualSave}
          placeholder="Untitled note"
          className="h-auto border-none bg-transparent px-0 font-serif text-2xl font-medium shadow-none focus-visible:ring-0"
        />
        <p className="text-xs text-muted-foreground">{relativeUpdated(updatedAt)}</p>
      </div>

      <div className="flex flex-col gap-2">
        <Label className="text-xs font-medium text-muted-foreground">Tags</Label>
        <TagEditor tags={tags} onAdd={handleAddTag} onRemove={handleRemoveTag} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="note-content" className="sr-only">
          Content
        </Label>
        <Textarea
          id="note-content"
          value={content}
          onChange={(e) => handleContentChange(e.target.value)}
          onBlur={handleManualSave}
          placeholder="Start writing…"
          className="min-h-[50vh] resize-y border-none bg-transparent px-0 font-serif text-base leading-relaxed shadow-none focus-visible:ring-0"
        />
      </div>

      {showAI && (
        <AIPanel
          noteId={note.id}
          contentLength={content.length}
          hasContent={content.trim().length > 0}
          existingTagNames={tags.map((t) => t.name)}
          ensureSaved={ensureSaved}
          onAcceptTag={handleAddTag}
          onApplyRewrite={handleApplyRewrite}
        />
      )}

      <div className="flex justify-end border-t pt-4">
        <Button
          size="sm"
          variant="secondary"
          onClick={handleManualSave}
          disabled={saveState === "saving" || saveState === "saved"}
          title="⌘S / Ctrl+S"
        >
          Save now
        </Button>
      </div>
    </div>
  );
}
