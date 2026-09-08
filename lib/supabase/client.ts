import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";

/**
 * Supabase client for use in Client Components. Uses the anon key only —
 * RLS policies enforce per-user access, so this key is safe to expose to
 * the browser.
 *
 * Both `NEXT_PUBLIC_*` values are inlined into the client bundle at
 * build time, so this deliberately does NOT import `lib/env.ts` (which
 * is marked `server-only` and would break the browser bundle). If either
 * is missing, this throws a clear, specific error rather than letting
 * `@supabase/ssr` fail later with a less obvious message deep inside an
 * auth call.
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing required environment variable: " +
        (!url ? "NEXT_PUBLIC_SUPABASE_URL" : "NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    );
  }

  return createBrowserClient<Database>(url, anonKey);
}
