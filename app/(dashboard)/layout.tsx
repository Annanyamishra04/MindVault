import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { UserMenu } from "@/components/layout/user-menu";
import { MobileNav } from "@/components/layout/mobile-nav";
import { KeyboardShortcutsProvider } from "@/components/layout/keyboard-shortcuts-provider";
import type { ReactNode } from "react";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The proxy already redirects unauthenticated requests away from
  // these routes; this is a defense-in-depth check for the layout
  // itself, since Server Components can't rely on the proxy alone for
  // data they're about to fetch.
  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .single();

  return (
    <div className="flex min-h-full flex-1">
      <KeyboardShortcutsProvider />
      <aside className="hidden w-64 shrink-0 flex-col border-r bg-card md:flex">
        <div className="p-4 font-serif text-lg font-medium">MindVault</div>
        <SidebarNav />
        <UserMenu email={user.email ?? ""} fullName={profile?.full_name ?? null} />
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex h-14 items-center gap-3 border-b px-4 md:hidden">
          <MobileNav />
          <span className="font-serif text-lg font-medium">MindVault</span>
        </header>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
