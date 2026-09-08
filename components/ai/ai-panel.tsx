"use client";

import { Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MAX_AI_INPUT_CHARS } from "@/lib/ai/limits";
import { SummaryTab } from "@/components/ai/summary-tab";
import { KeyPointsTab } from "@/components/ai/key-points-tab";
import { TagSuggestionsTab } from "@/components/ai/tag-suggestions-tab";
import { RewriteTab } from "@/components/ai/rewrite-tab";
import { RelatedNotesTab } from "@/components/ai/related-notes-tab";

interface AIPanelProps {
  noteId: string;
  contentLength: number;
  hasContent: boolean;
  existingTagNames: string[];
  ensureSaved: () => Promise<{ ok: true } | { ok: false; error: string }>;
  onAcceptTag: (name: string) => Promise<{ success: boolean; error?: string }>;
  onApplyRewrite: (content: string) => Promise<{ ok: true } | { ok: false; error: string }>;
}

/**
 * The single "AI action area" for a note (Phase 6 requirement: a clean
 * menu rather than a row of buttons scattered around the editor). Each
 * tab is independent: generating a summary doesn't block key points,
 * tags, or rewrite, and each keeps its own result/loading/error state
 * so switching tabs never loses a result that's already on screen —
 * nothing here re-calls Gemini just because the user looked away and
 * back.
 *
 * `ensureSaved` is called before every AI action (see NoteEditor) so
 * the Server Action always operates on the note's current saved
 * content — AI actions take only a note id, never note text, from the
 * browser (see lib/ai/actions.ts for why).
 */
export function AIPanel({
  noteId,
  contentLength,
  hasContent,
  existingTagNames,
  ensureSaved,
  onAcceptTag,
  onApplyRewrite,
}: AIPanelProps) {
  const tooLong = contentLength > MAX_AI_INPUT_CHARS;
  const disabled = !hasContent || tooLong;

  return (
    <Card>
      <CardHeader className="pb-0">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Sparkles className="size-4 text-accent" />
          AI Tools
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        {!hasContent && (
          <p className="pb-3 text-xs text-muted-foreground">
            Add some content to this note to use AI tools.
          </p>
        )}
        {tooLong && (
          <p className="pb-3 text-xs text-muted-foreground">
            This note is too long for AI tools right now (limit{" "}
            {MAX_AI_INPUT_CHARS.toLocaleString()} characters).
          </p>
        )}

        <Tabs defaultValue="summary">
          {/* Phase 9 mobile fix: this was `grid grid-cols-5`, which forced
              all five triggers (including "Key Points" and "Related") into
              equal-width, `whitespace-nowrap` columns with no room to
              shrink — on a narrow phone viewport the row simply overflowed
              its card with clipped/cut-off labels. A horizontally
              scrollable flex row keeps every label fully readable at any
              width; each trigger gets `shrink-0` so it keeps its natural
              size instead of being squeezed. Looks identical to the
              previous grid on desktop, where five triggers already fit. */}
          <TabsList className="flex w-full items-center gap-1 overflow-x-auto">
            <TabsTrigger value="summary" className="shrink-0">
              Summary
            </TabsTrigger>
            <TabsTrigger value="key-points" className="shrink-0">
              Key Points
            </TabsTrigger>
            <TabsTrigger value="tags" className="shrink-0">
              Tags
            </TabsTrigger>
            <TabsTrigger value="rewrite" className="shrink-0">
              Rewrite
            </TabsTrigger>
            <TabsTrigger value="related" className="shrink-0">
              Related
            </TabsTrigger>
          </TabsList>

          <TabsContent value="summary" className="pt-4">
            <SummaryTab noteId={noteId} disabled={disabled} ensureSaved={ensureSaved} />
          </TabsContent>
          <TabsContent value="key-points" className="pt-4">
            <KeyPointsTab noteId={noteId} disabled={disabled} ensureSaved={ensureSaved} />
          </TabsContent>
          <TabsContent value="tags" className="pt-4">
            <TagSuggestionsTab
              noteId={noteId}
              disabled={disabled}
              ensureSaved={ensureSaved}
              existingTagNames={existingTagNames}
              onAcceptTag={onAcceptTag}
            />
          </TabsContent>
          <TabsContent value="rewrite" className="pt-4">
            <RewriteTab
              noteId={noteId}
              disabled={disabled}
              ensureSaved={ensureSaved}
              onApplyRewrite={onApplyRewrite}
            />
          </TabsContent>
          <TabsContent value="related" className="pt-4">
            <RelatedNotesTab noteId={noteId} ensureSaved={ensureSaved} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
