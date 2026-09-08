import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

export default function TagsLoading() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-7 w-24" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} className="flex-row items-center justify-between gap-3 p-4">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-5 w-14 rounded-md" />
          </Card>
        ))}
      </div>
    </div>
  );
}
