"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function ActiveTagFilter({ tagName, clearHref }: { tagName: string; clearHref: string }) {
  return (
    <Badge variant="accent" className="gap-1.5 py-1 pl-3 pr-1.5 text-sm font-normal">
      Tag: {tagName}
      <Link
        href={clearHref}
        aria-label={`Clear "${tagName}" filter`}
        className="rounded-full p-0.5 hover:bg-black/10"
      >
        <X className="size-3" />
      </Link>
    </Badge>
  );
}
