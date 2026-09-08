"use client";

import { useEffect } from "react";

/**
 * Catch-all for an error thrown by the root layout itself (`app/layout.tsx`)
 * or anything above every other error boundary in the tree — the one
 * case none of the per-route `error.tsx` files (including
 * `app/(dashboard)/error.tsx`, added in Phase 9) can catch, because a
 * route's error boundary is rendered *inside* the root layout, not
 * around it. Without this file, that specific failure mode falls
 * through to Next.js's own unstyled default error page instead of
 * anything in this app's design system.
 *
 * `global-error.tsx` replaces the entire root layout when it renders, so
 * per Next.js's own requirement it must render its own `<html>`/`<body>`.
 * It deliberately does NOT import `globals.css`, the fonts, or
 * `ThemeProvider` — if the root layout itself is what failed, importing
 * more of the same app code here would risk the fallback failing too.
 * Plain inline styles keep this resilient on its own.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Logged client-side only — never rendered. See app/(dashboard)/error.tsx
    // for why raw error details never reach the UI.
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          display: "flex",
          minHeight: "100vh",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          padding: "1.5rem",
          textAlign: "center",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          color: "#1a1a1a",
          background: "#fff",
        }}
      >
        <div>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "0.5rem" }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: "0.9rem", color: "#666", maxWidth: "24rem" }}>
            MindVault hit an unexpected error and couldn&apos;t load. This is usually
            temporary — please try again.
          </p>
        </div>
        <button
          onClick={reset}
          style={{
            padding: "0.5rem 1.25rem",
            borderRadius: "0.375rem",
            border: "none",
            background: "#1a1a1a",
            color: "#fff",
            fontSize: "0.875rem",
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
