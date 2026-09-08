"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FileText,
  Star,
  Tag,
  Sparkles,
  Settings,
  PlusCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const NAV_LINK_CLASS =
  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background";

function navLinkClass(isActive: boolean) {
  return cn(
    NAV_LINK_CLASS,
    isActive
      ? "bg-secondary text-secondary-foreground"
      : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
  );
}

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/notes", label: "All Notes", icon: FileText },
  { href: "/favorites", label: "Favorites", icon: Star },
  { href: "/tags", label: "Tags", icon: Tag },
];

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-1 flex-col gap-6 overflow-y-auto p-4">
      <Button asChild className="justify-start gap-2">
        <Link href="/notes/new">
          <PlusCircle className="size-4" />
          New Note
        </Link>
      </Button>

      <div className="flex flex-col gap-1">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              aria-current={isActive ? "page" : undefined}
              className={navLinkClass(isActive)}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          );
        })}
      </div>

      <div className="mt-auto flex flex-col gap-1">
        <Link
          href="/assistant"
          aria-current={pathname.startsWith("/assistant") ? "page" : undefined}
          className={navLinkClass(pathname.startsWith("/assistant"))}
        >
          <Sparkles className="size-4" />
          AI Assistant
        </Link>
        <Link
          href="/settings"
          aria-current={pathname.startsWith("/settings") ? "page" : undefined}
          className={navLinkClass(pathname.startsWith("/settings"))}
        >
          <Settings className="size-4" />
          Settings
        </Link>
      </div>
    </nav>
  );
}
