import { AlertCircle } from "lucide-react";

export function AIError({ message }: { message: string }) {
  return (
    <p role="alert" className="flex items-start gap-1.5 text-xs text-destructive">
      <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
      {message}
    </p>
  );
}
