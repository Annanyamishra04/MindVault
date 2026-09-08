/**
 * Sanitizes a `redirectTo` value pulled from a query string into a
 * plain, same-origin, in-app path.
 *
 * `redirectTo` is attacker-controlled (it's a URL query parameter —
 * either set by proxy.ts when it bounces someone off a protected
 * route, or typed/edited directly by anyone), so it must never be
 * trusted as-is. Handing an unsanitized value to `router.push()` or a
 * `Location` header is a classic open-redirect vector: it can be used
 * to make a link that *looks* like it points at this app but actually
 * sends an authenticated user's browser somewhere else entirely
 * (typically to phish credentials or tokens on a look-alike page).
 *
 * Rejects, in order:
 * - anything that isn't a same-origin path at all (`https://evil.com`,
 *   `javascript:alert(1)`, `mailto:...` — none of these start with a
 *   bare "/")
 * - protocol-relative URLs (`//evil.com`), which the browser resolves
 *   using the *target* page's scheme against a *different* host
 * - backslashes (`/\evil.com`), because some URL parsers normalize
 *   them to forward slashes, turning them into a protocol-relative URL
 *   after the fact — a well-known bypass for naive same-origin checks
 * - malformed paths, by parsing against a fixed dummy origin and
 *   confirming both that it doesn't throw and that it still resolves
 *   to that same dummy origin (catches anything smuggling a scheme or
 *   host in through the path that the string checks above missed)
 *
 * Falls back to `/dashboard` for anything that doesn't survive all of
 * the above.
 */
export function safeRedirect(target: string | null | undefined): string {
  if (!target) return "/dashboard";

  if (!target.startsWith("/") || target.startsWith("//") || target.includes("\\")) {
    return "/dashboard";
  }

  try {
    const resolved = new URL(target, "http://localhost");
    if (resolved.origin !== "http://localhost") return "/dashboard";
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return "/dashboard";
  }
}
