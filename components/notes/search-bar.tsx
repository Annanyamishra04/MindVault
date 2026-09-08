"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import { Search, Loader2, X } from "lucide-react";
import { useDebouncedCallback } from "@/lib/hooks/use-debounced-callback";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/**
 * Keyword search box for /notes and /favorites. Debounces navigation
 * (not a raw fetch) so the server component re-renders with filtered
 * results roughly 350ms after the user stops typing, and never on
 * every keystroke.
 */
export function SearchBar({ placeholder = "Search notes…" }: { placeholder?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(searchParams.get("q") ?? "");
  const [isPending, startTransition] = useTransition();

  const debouncedNavigate = useDebouncedCallback((next: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next.trim()) {
      params.set("q", next.trim());
    } else {
      params.delete("q");
    }
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`);
    });
  }, 350);

  function handleChange(next: string) {
    setValue(next);
    debouncedNavigate(next);
  }

  function handleClear() {
    setValue("");
    const params = new URLSearchParams(searchParams.toString());
    params.delete("q");
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`);
    });
  }

  return (
    <div className="relative w-full max-w-sm">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={placeholder}
        aria-label="Search notes"
        title="Press / to focus search"
        data-shortcut="search-input"
        className="pl-9 pr-9"
      />
      {isPending ? (
        <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
      ) : (
        value && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-1 top-1/2 size-6 -translate-y-1/2"
            onClick={handleClear}
            aria-label="Clear search"
          >
            <X className="size-3.5" />
          </Button>
        )
      )}
    </div>
  );
}
