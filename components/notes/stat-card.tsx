import type { ComponentType } from "react";
import { Card } from "@/components/ui/card";

export function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: number;
}) {
  return (
    <Card className="flex-row items-center gap-4 p-5">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary">
        <Icon className="size-5 text-muted-foreground" />
      </div>
      <div className="flex flex-col">
        <span className="font-serif text-2xl font-medium">{value.toLocaleString()}</span>
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
    </Card>
  );
}
