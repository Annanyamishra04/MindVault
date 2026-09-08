import { AskPanel } from "@/components/assistant/ask-panel";

export default function AssistantPage() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium">Ask My Notes</h1>
        <p className="text-sm text-muted-foreground">
          Ask a question in your own words. Answers are grounded strictly in your own notes, with
          sources you can open.
        </p>
      </div>
      <AskPanel />
    </div>
  );
}
