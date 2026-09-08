"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { SidebarNav } from "./sidebar-nav";

/**
 * Mobile equivalent of the desktop sidebar, shown as a slide-over
 * triggered from the topbar. Reuses SidebarNav so nav items never drift
 * out of sync between breakpoints.
 */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const previousPathname = useRef(pathname);

  // Tapping a nav link inside the drawer navigates but doesn't close a
  // Dialog on its own — without this, the drawer stayed open over the
  // freshly-loaded page until the user tapped the backdrop themselves.
  useEffect(() => {
    if (pathname !== previousPathname.current) {
      previousPathname.current = pathname;
      setOpen(false);
    }
  }, [pathname]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
      >
        <Menu className="size-5" />
      </Button>
      <DialogContent className="left-0 top-0 h-full max-w-[280px] translate-x-0 translate-y-0 rounded-none border-r p-0 data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left">
        <DialogTitle className="sr-only">Navigation</DialogTitle>
        <div className="flex h-full flex-col">
          <div className="p-4 font-serif text-lg font-medium">MindVault</div>
          <SidebarNav />
        </div>
      </DialogContent>
    </Dialog>
  );
}
