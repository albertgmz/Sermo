"use client";

import { Send } from "lucide-react";
import { useActionState } from "react";
import { echoMarkdown } from "@/app/(main)/ui/actions";
import { Editor } from "@/components/forum/editor";
import { Markdown } from "@/components/forum/markdown";
import { Button } from "@/components/ui/button";

export function EditorDemo() {
  const [markdown, action, pending] = useActionState(echoMarkdown, "");
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <form action={action} className="min-w-0 space-y-3">
        <Editor name="body" />
        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>
            <Send />
            Submit
          </Button>
        </div>
      </form>
      <div className="min-w-0 rounded-lg border bg-card p-4">
        <p className="mb-3 text-xs font-semibold text-muted-foreground">
          Submitted Markdown
        </p>
        {markdown ? (
          <Markdown>{markdown}</Markdown>
        ) : (
          <p className="text-sm text-muted-foreground">
            Submit the form to see the rendered result. The editor clears itself
            afterwards.
          </p>
        )}
      </div>
    </div>
  );
}
