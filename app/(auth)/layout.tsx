import Link from "next/link";
import type { ReactNode } from "react";

// Login/signup have no reason to be statically prerendered at build
// time, and doing so is actively harmful here: the Supabase browser
// client needs real NEXT_PUBLIC_SUPABASE_URL/ANON_KEY values to
// construct itself, so a static build would either require injecting
// placeholder secrets at build time or fail outright. Rendering these
// routes dynamically (per-request) defers that requirement to runtime,
// where it belongs — a deployment that's actually missing its Supabase
// env vars will still fail loudly the moment someone visits /login or
// /signup, which is the correct behavior; it's just no longer a
// build-time concern.
export const dynamic = "force-dynamic";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-6 py-16">
      <Link href="/" className="font-serif text-xl font-medium">
        MindVault
      </Link>
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
