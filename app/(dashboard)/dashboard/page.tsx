import Link from "next/link";
import { FileText, Star, Sparkles, PlusCircle } from "lucide-react";
import { getDashboardStats } from "@/lib/notes/queries";
import { StatCard } from "@/components/notes/stat-card";
import { NotesGrid } from "@/components/notes/notes-grid";
import { EmptyState } from "@/components/notes/empty-state";
import { Button } from "@/components/ui/button";

export default async function DashboardPage() {
  const stats = await getDashboardStats();

  if (stats.totalNotes === 0) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="font-serif text-2xl font-medium">Dashboard</h1>
          <p className="text-muted-foreground">Note stats and recent activity appear here.</p>
        </div>
        <EmptyState
          icon={Sparkles}
          title="Your second brain starts here."
          description="Capture ideas, thoughts, and knowledge in one place."
          action={
            <Button asChild className="mt-2 gap-2">
              <Link href="/notes/new">
                <PlusCircle className="size-4" />
                Create your first note
              </Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-medium">Dashboard</h1>
          <p className="text-muted-foreground">Here&apos;s what&apos;s in your vault.</p>
        </div>
        <Button asChild className="gap-2">
          <Link href="/notes/new">
            <PlusCircle className="size-4" />
            New Note
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard icon={FileText} label="Total Notes" value={stats.totalNotes} />
        <StatCard icon={Star} label="Favorite Notes" value={stats.favoriteCount} />
        <StatCard icon={Sparkles} label="Created in the last 7 days" value={stats.recentCount} />
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-lg font-medium">Recent Notes</h2>
          <Link href="/notes" className="text-sm text-muted-foreground hover:text-foreground">
            View all
          </Link>
        </div>
        <NotesGrid notes={stats.recentNotes} emptyState={null} />
      </div>
    </div>
  );
}
