import { z } from "zod";

/**
 * Shared client-side validation for the login and signup forms.
 *
 * This is intentionally light — it exists to give immediate,
 * field-level feedback before a network round-trip, not to duplicate
 * Supabase Auth's own server-side rules (password strength policy,
 * duplicate-email detection, etc.), which are the actual source of
 * truth and are surfaced separately via lib/auth/errors.ts.
 */

export const loginSchema = z.object({
  email: z.string().trim().min(1, "Email is required.").email("Enter a valid email address."),
  password: z.string().min(1, "Password is required."),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const signupSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(1, "Full name is required.")
      .max(120, "Full name is too long."),
    email: z.string().trim().min(1, "Email is required.").email("Enter a valid email address."),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters.")
      .max(72, "Password is too long."),
    confirmPassword: z.string().min(1, "Please confirm your password."),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match.",
    path: ["confirmPassword"],
  });

export type SignupInput = z.infer<typeof signupSchema>;

/**
 * Flattens a Zod error into a simple `{ field: message }` map, taking
 * only the first issue per field — enough for inline form feedback
 * without a full error-list UI.
 */
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
