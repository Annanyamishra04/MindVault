import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv } from "@/lib/env";

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/notes",
  "/favorites",
  "/tags",
  "/assistant",
  "/settings",
];

const AUTH_PREFIXES = ["/login", "/signup"];

export async function proxy(request: NextRequest) {
  // This is the response we'll return by default (the "pass through"
  // case). `setAll` below may replace it with a fresh `NextResponse.next()`
  // carrying refreshed session cookies — see the comment there.
  let response = NextResponse.next({ request });

  const { url, anonKey } = getSupabaseEnv();

  const supabase = createServerClient(
    url,
    anonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Refresh the session if expired. Required for Server Components,
  // which cannot set cookies themselves. If the access token was
  // expired, this call rotates it and `setAll` above swaps `response`
  // for one carrying the new session cookies.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isProtected = PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  const isAuthPage = AUTH_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  // Redirects need their own response object (NextResponse.redirect
  // creates a brand-new one), so any refreshed session cookies captured
  // on `response` above have to be copied across explicitly — otherwise
  // a just-rotated refresh token never reaches the browser. Concretely:
  // an authenticated user with a stale access token hits /login, we
  // refresh their token server-side (so `user` resolves and we decide
  // to redirect them to /dashboard), but if we returned a bare
  // `NextResponse.redirect(...)` here the browser would keep using the
  // OLD refresh token on its next request. Since Supabase rotates
  // refresh tokens on use, that stale token can then fail — silently
  // signing the user back out. Copying the cookies over is what the
  // Supabase docs' own reference implementation does, and it's not
  // optional.
  function redirectWithSessionCookies(url: URL) {
    const redirectResponse = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie);
    });
    return redirectResponse;
  }

  // Unauthenticated visitor hitting a protected route -> bounce to
  // /login, remembering where they were headed so we can send them
  // back after a successful login.
  if (isProtected && !user) {
    const redirectUrl = new URL("/login", request.url);
    redirectUrl.searchParams.set("redirectTo", pathname);
    return redirectWithSessionCookies(redirectUrl);
  }

  // Already-authenticated visitor hitting /login or /signup -> there's
  // nothing for them to do there, send them straight to the dashboard.
  // This is server-side (not just a client-side check in the pages
  // themselves), so it can't be bypassed by disabling JavaScript or
  // racing the client redirect.
  if (isAuthPage && user) {
    return redirectWithSessionCookies(new URL("/dashboard", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except Next.js internals and common
     * static-asset extensions, so the proxy (and the Supabase auth
     * check it performs on every request) doesn't run against files
     * that can never be a protected page or an auth page anyway.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff|woff2|ttf|map)$).*)",
  ],
};
