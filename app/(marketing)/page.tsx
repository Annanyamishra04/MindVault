import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Placeholder landing page for Phase 1. The full marketing page (hero,
 * feature sections, product preview) is built in Phase 10, once the
 * underlying features actually exist to describe accurately.
 */
export default function MarketingPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="font-serif text-4xl font-medium tracking-tight sm:text-5xl">
        Your notes. Understood by AI.
      </h1>
      <p className="max-w-md text-muted-foreground">
        MindVault is under active development. The dashboard, editor, and AI
        features are being built phase by phase.
      </p>
      <div className="flex gap-3">
        <Button asChild>
          <Link href="/signup">Start taking notes</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/login">Log in</Link>
        </Button>
      </div>
    </main>
  );
}
