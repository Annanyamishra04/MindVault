# Phase 3 Final Code Review

This documents a review pass over the Phase 3 authentication
implementation, performed against the actual code on disk (not the
prior implementation report). Three real bugs were found and fixed;
everything else was verified correct as-is.

## Real issues found and fixed

### 1. `proxy.ts` dropped refreshed session cookies on every redirect

**The bug:** `supabase.auth.getUser()` can rotate the session's cookies
(e.g. refreshing an expired access token). The Supabase SSR client
communicates that back via the `setAll` callback, which replaced the
local `response` variable with a fresh `NextResponse.next()` carrying
the new cookies. But both redirect paths (`isProtected && !user` →
`/login`, `isAuthPage && user` → `/dashboard`) returned a brand-new
`NextResponse.redirect(...)` instead of `response` — so any cookies
`setAll` had just written were silently discarded.

**Why it matters:** Supabase rotates refresh tokens on use. Concretely:
an authenticated user with a stale access token visits `/login`. The
proxy refreshes their token server-side (so `user` resolves and it
decides to redirect to `/dashboard`) — but the old code sent the
browser a redirect with none of the new cookies. The browser keeps
using its old refresh token on the next request, which has already
been consumed and rotated away server-side, and the user gets silently
signed out. This is exactly the failure mode Supabase's own reference
middleware implementation warns about.

**The fix:** both redirects now copy `response.cookies.getAll()` onto
the redirect response before returning it (`redirectWithSessionCookies`
helper in `proxy.ts`).

### 2. `getAuthErrorMessage` missed two entire classes of Supabase errors

**The bug:** the function only checked `isAuthApiError(error)`. But
`@supabase/auth-js` (the version actually installed, `^2.112.4` via
`@supabase/supabase-js`) represents weak-password and
retryable-network failures as their *own* subclasses —
`AuthWeakPasswordError` and `AuthRetryableFetchError` — whose `.name`
is not `"AuthApiError"`. `isAuthApiError` returns `false` for both, so
they fell through to the generic "Something went wrong" fallback.

**Why it matters:** this directly undermined the signup-flow outcomes
the previous report claimed were handled — a weak password (outcome D)
and a network failure (outcome E) both showed a useless generic
message instead of the specific, actionable one already written for
them. Confirmed by inspecting the installed package's error classes
directly rather than assuming behavior.

**The fix:** `getAuthErrorMessage` now checks `isAuthRetryableFetchError`
and `isAuthWeakPasswordError` explicitly before falling back to the
generic `isAuthApiError`/`isAuthError` path.

### 3. Open-redirect: backslash bypass in `redirectTo` handling

**The bug:** `safeRedirect` rejected values starting with `//` (protocol-
relative) but not values starting with `/\` — e.g. `/\evil.com`. Some
URL parsers (historically, some browsers resolving `window.location`)
normalize a leading backslash to a forward slash, which would turn
this into a protocol-relative URL pointing at `evil.com`.

**Why it matters:** this is a known, named open-redirect bypass
technique, and the fix is cheap and unambiguous — not a hypothetical
worth skipping.

**The fix:** `safeRedirect` (extracted to `lib/auth/redirect.ts` so it's
actually unit-testable — it was previously a private function inside
the login page component) now rejects any value containing a
backslash, and additionally re-parses the value against a fixed dummy
origin (`new URL(target, "http://localhost")`) to confirm it still
resolves to that exact origin, catching anything the string checks
alone might miss.

## Confirmed correct as-is (no change made)

- **Server-side route protection** (`app/(dashboard)/layout.tsx`): calls
  `auth.getUser()` and `redirect("/login")` *before* fetching the
  profile or rendering any children — protected content genuinely
  cannot render before the auth check resolves. This is defense-in-depth
  on top of `proxy.ts`, not a replacement for it, which is the correct
  structure.
- **`lib/supabase/client.ts` / `lib/supabase/server.ts`**: correctly
  split (browser-only vs. server-only client), no service-role key, and
  — verified by reading the installed `@supabase/ssr` source directly
  rather than assuming — both `createBrowserClient` and
  `createServerClient` throw a clear, explicit error
  (`"Your project's URL and API key are required..."`) the moment
  they're constructed with a missing/empty URL or key. There is no path
  where a missing env var results in a silent connection to an invalid
  URL.
- **`app/(auth)/layout.tsx`**: `export const dynamic = "force-dynamic"`
  correctly keeps `/login` and `/signup` out of static prerendering (so
  `npm run build` needs no env vars) without touching the runtime
  validation above — a genuinely misconfigured deployment still fails
  loudly the moment someone visits either page.
- **RLS and the profile trigger** (`supabase/migrations/0001_init_schema.sql`,
  `0002_rls_policies.sql`): `handle_new_user()` is `security definer`
  with `search_path` pinned (prevents search-path-hijacking), inserts
  `profiles.id = auth.users.id` and `full_name` from
  `raw_user_meta_data`, and `profiles` RLS scopes both `select` and
  `update` to `auth.uid() = id` with no `insert`/`delete` policy for
  end users at all (profile rows can only come from the trigger). No
  changes were needed or made here.
- **Signup flow's 3-way response handling** (session issued /
  needs-confirmation / silent-existing-account) in
  `app/(auth)/signup/page.tsx`: logic was already correct; only the
  error-message mapping underneath it (issue #2 above) was broken.
- **`proxy.ts` redirect-loop analysis**: `PROTECTED_PREFIXES` and
  `AUTH_PREFIXES` are disjoint path sets, so no single request can match
  both conditions — there's no code path that redirects `/login` → some
  protected route → `/login` again.

## Compatibility with installed versions

Checked directly against `package.json` rather than assumed:
`next@16.3.4`, `@supabase/ssr@^0.12.5`, `@supabase/supabase-js@^2.112.4`.

- The `getAll`/`setAll` cookie interface used in `proxy.ts` and
  `lib/supabase/server.ts` is the current `@supabase/ssr` API for this
  version (the older `get`/`set`/`remove` interface is deprecated).
- `middleware.ts` → `proxy.ts` (function `middleware` → `proxy`) is the
  Next.js 16 convention; `config.matcher` is unchanged in shape.
- `isAuthApiError`, `isAuthError`, `isAuthRetryableFetchError`,
  `isAuthWeakPasswordError`, and the `AuthError`/`AuthApiError`/
  `AuthWeakPasswordError`/`AuthRetryableFetchError` classes are all
  confirmed present and re-exported from `@supabase/supabase-js` (via
  `export * from "@supabase/auth-js"`) at the installed version.

## Testing performed

No test framework exists in this project (`package.json` has no
jest/vitest/playwright/cypress), and none was added — per instructions,
this review didn't introduce one.

**Actually executed:**
- `npm ci`, `npm run lint`, `npm run build` — all pass, with zero
  environment variables set (see below), zero warnings.
- A throwaway Node/tsx script exercising the pure, side-effect-free
  logic in `lib/validation/auth.ts`, `lib/auth/errors.ts`, and
  `lib/auth/redirect.ts` — 19 checks, all passing, including two written
  specifically to catch the bugs above (`AuthWeakPasswordError`/
  `AuthRetryableFetchError` mapping, and the backslash open-redirect
  bypass). The script was deleted after use; it's not part of the
  deliverable and there's no permanent test suite.

**Requires a real Supabase project (not executed here):** everything
that touches the network — actual signup/login/logout round-trips,
session persistence across a real browser refresh, the email
confirmation link flow, and the profile trigger firing against live
Postgres. The manual checklist for these lives in the README under
"Manual Auth Test Checklist".
