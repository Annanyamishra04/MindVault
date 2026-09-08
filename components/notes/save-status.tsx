import { Check, Loader2, Circle, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type SaveState = "saved" | "saving" | "unsaved" | "error";

const CONFIG: Record<SaveState, { icon: typeof Check; label: string; className: string }> = {
  saved: { icon: Check, label: "Saved", className: "text-muted-foreground" },
  saving: { icon: Loader2, label: "Saving…", className: "text-muted-foreground" },
  unsaved: { icon: Circle, label: "Unsaved changes", className: "text-muted-foreground" },
  error: { icon: AlertCircle, label: "Couldn't save", className: "text-destructive" },
};

export function SaveStatus({ state }: { state: SaveState }) {
  const { icon: Icon, label, className } = CONFIG[state];
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn("flex items-center gap-1.5 text-xs", className)}
    >
      <Icon className={cn("size-3.5", state === "saving" && "animate-spin")} />
      {label}
    </span>
  );
}
