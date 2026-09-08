import { createClient } from "@/lib/supabase/server";
import { ThemeToggle } from "@/components/settings/theme-toggle";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const SHORTCUTS: Array<{ keys: string; description: string }> = [
  { keys: "⌘ / Ctrl + N", description: "Create a new note" },
  { keys: "⌘ / Ctrl + S", description: "Save the note you're editing" },
  { keys: "/", description: "Jump to the search box" },
  { keys: "Esc", description: "Close the open dialog" },
];

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = user
    ? await supabase.from("profiles").select("full_name").eq("id", user.id).single()
    : { data: null };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div>
        <h1 className="font-serif text-2xl font-medium">Settings</h1>
        <p className="text-muted-foreground">Manage your account and how MindVault looks.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-serif text-lg font-medium">Account</CardTitle>
          <CardDescription>Your MindVault sign-in details.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-muted-foreground">Name</span>
            <span className="text-sm font-medium">{profile?.full_name || "Not set"}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-muted-foreground">Email</span>
            <span className="text-sm font-medium">{user?.email ?? "—"}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-serif text-lg font-medium">Appearance</CardTitle>
          <CardDescription>Choose how MindVault looks on this device.</CardDescription>
        </CardHeader>
        <CardContent>
          <ThemeToggle />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-serif text-lg font-medium">Keyboard shortcuts</CardTitle>
          <CardDescription>Work faster without leaving the keyboard.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="flex flex-col divide-y">
            {SHORTCUTS.map(({ keys, description }) => (
              <div
                key={keys}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 py-2.5 first:pt-0 last:pb-0"
              >
                <dt className="text-sm text-muted-foreground">{description}</dt>
                <dd className="shrink-0">
                  <kbd className="rounded-md border bg-secondary px-2 py-1 font-mono text-xs font-medium">
                    {keys}
                  </kbd>
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
