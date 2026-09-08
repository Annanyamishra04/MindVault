import { z } from "zod";

/**
 * Shared validation for note and tag input, used both for immediate
 * client-side feedback and (critically) re-validated on the server
 * inside every Server Action in lib/notes/actions.ts — the client
 * checks are a UX nicety, never the security boundary.
 */

export const noteTitleSchema = z
  .string()
  .trim()
  .min(1, "Title is required.")
  .max(200, "Title must be 200 characters or fewer.");

// Empty content is allowed (a fresh note starts blank), just capped so
// a single row can't blow past reasonable limits.
export const noteContentSchema = z
  .string()
  .max(100_000, "Note content is too long.");

export const tagNameSchema = z
  .string()
  .trim()
  .min(1, "Tag name can't be empty.")
  .max(50, "Tag names must be 50 characters or fewer.")
  // Keeps tag names to a single line of readable text — no embedded
  // newlines/tabs from a paste, which would otherwise render oddly as
  // pill labels.
  .regex(/^[^\r\n\t]+$/, "Tag names can't contain line breaks.");

export const createNoteSchema = z.object({
  title: noteTitleSchema,
  content: noteContentSchema.default(""),
  isFavorite: z.boolean().default(false),
  tags: z.array(tagNameSchema).max(20, "A note can have at most 20 tags.").default([]),
});

export type CreateNoteInput = z.infer<typeof createNoteSchema>;

export const updateNoteSchema = z.object({
  title: noteTitleSchema,
  content: noteContentSchema,
});

export type UpdateNoteInput = z.infer<typeof updateNoteSchema>;

export function fieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !(key in result)) {
      result[key] = issue.message;
    }
  }
  return result;
}
