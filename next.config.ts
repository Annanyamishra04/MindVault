import type { NextConfig } from "next";

/**
 * Production-safe HTTP security headers (Phase 9, section 6).
 *
 * Applied to every route via the catch-all `source: "/(.*)"` matcher —
 * there's no reason any response from this app should omit them.
 *
 * Deliberately NOT included: Content-Security-Policy.
 *
 * A real CSP is the single highest-value security header left, but this
 * app can't safely ship one without either weakening it into
 * uselessness or a genuine architecture change:
 *   - Next.js's App Router injects its own inline bootstrap scripts
 *     (RSC payload hydration, dev-mode HMR) with no static hash and no
 *     nonce wired up in this project. A `script-src` that doesn't
 *     account for that either breaks the app outright or has to fall
 *     back to `'unsafe-inline'` — which defeats the point of a CSP's
 *     script-src in the first place.
 *   - A correct fix is per-request nonces: generate a nonce in `proxy.ts`
 *     for every request, forward it via a response header, and have
 *     Next.js thread it through `<Script nonce=...>` / the RSC runtime.
 *     That's a real (if fairly mechanical) change across the request
 *     pipeline, not a config tweak — out of scope for a hardening pass
 *     that's explicitly told not to redesign approved architecture.
 *   - Supabase (`*.supabase.co`) and, if ever called from the browser,
 *     any Gemini host would also need explicit `connect-src` entries;
 *     today every Gemini call is server-only (see README's Security
 *     section), so that particular risk is already closed without a CSP.
 *
 * Shipping a `script-src 'unsafe-inline'` CSP would look like coverage
 * without providing any real XSS protection, so per Phase 9's own
 * instruction ("do NOT ship a broken policy"), this is documented here
 * instead. If this becomes a priority, the nonce-based approach above is
 * the correct next step — Next.js's own middleware CSP guide documents
 * the exact pattern: https://nextjs.org/docs/app/guides/content-security-policy
 */
const securityHeaders = [
  // Prevents the browser from MIME-sniffing a response into a
  // different content type than the server declared — closes off a
  // class of stored-XSS-via-upload tricks. No feature in this app
  // relies on sniffing, so this is free.
  { key: "X-Content-Type-Options", value: "nosniff" },

  // Only send the origin (not the full URL, which could contain a
  // note id or a search query) to a *cross-origin* link's destination;
  // full URL is still sent for same-origin navigation. Notes are
  // private by default, so this avoids leaking a note id in a Referer
  // header to any external link a note's content might contain.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },

  // Disables browser features this app never uses, so an XSS bug (or a
  // malicious/compromised embedded iframe, of which this app has none
  // today) couldn't invoke them either. Conservative allow-list of
  // "none" for the sensor/media APIs most commonly abused.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },

  // Clickjacking protection: this app has no legitimate reason to be
  // framed by another site, so deny it outright rather than relying on
  // CSP's frame-ancestors alone (older browsers only honor this header).
  { key: "X-Frame-Options", value: "DENY" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
