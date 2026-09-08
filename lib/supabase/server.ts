import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/database";
import { getSupabaseEnv } from "@/lib/env";

/**
 * Supabase client for Server Components, Route Handlers, and Server
 * Actions. Reads the user's session from cookies, so all queries are
 * automatically scoped by RLS to the authenticated user — this is the
 * client that should be used for almost everything server-side.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const { url, anonKey } = getSupabaseEnv();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Called from a Server Component with no request context to
          // write to — safe to ignore because proxy.ts refreshes the
          // session on every request.
        }
      },
    },
  });
}
