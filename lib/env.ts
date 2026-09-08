import "server-only";

/**
 * Centralized, actionable environment variable validation.
 *
 * Before Phase 9, `lib/supabase/server.ts`, `lib/supabase/client.ts`, and
 * `proxy.ts` each read `NEXT_PUBLIC_SUPABASE_URL!` /
 * `NEXT_PUBLIC_SUPABASE_ANON_KEY!` with a bare non-null assertion. That
 * compiles fine, but if the variable is genuinely missing at runtime the
 * failure a developer actually sees is whatever `@supabase/ssr` throws
 * internally (e.g. a cryptic "supabaseUrl is required" or a malformed-URL
 * error several stack frames deep) — not something that clearly says
 * *which* `.env.local` entry is missing.
 *
 * This module fixes that with one small, dependency-free helper, reused
 * everywhere a required server-side env var is read. It intentionally:
 *   - throws only at first *use* (inside a function body), never at
 *     module-import time — so `npm run build` and `npm run lint` never
 *     require real credentials just to compile the app (same requirement
 *     Phase 9 already holds `lib/ai/gemini.ts`'s `requireEnv` to).
 *   - uses the exact "Missing required environment variable: X" message
 *     shape `lib/ai/errors.ts::getAIErrorMessage` already pattern-matches
 *     on for AI-related failures, so this stays consistent with the
 *     existing error-mapping convention rather than inventing a second one.
 *   - never logs or returns the *value* of a secret, only the *name* of
 *     the missing variable — the name alone is safe to show a developer;
 *     the value never should be.
 */
export function requireServerEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * The two Supabase variables every server-side Supabase client in this
 * app needs (`lib/supabase/server.ts`, `lib/supabase/client.ts`,
 * `proxy.ts`). Despite the `NEXT_PUBLIC_` prefix — which only means
 * "safe to expose to the browser," not "optional" — these are just as
 * required as `AI_API_KEY`; there is no code path in this app that works
 * without a real Supabase project configured.
 */
export function getSupabaseEnv(): { url: string; anonKey: string } {
  return {
    url: requireServerEnv("NEXT_PUBLIC_SUPABASE_URL"),
    anonKey: requireServerEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  };
}
