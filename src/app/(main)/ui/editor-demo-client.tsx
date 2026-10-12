"use client";

import { Send } from "lucide-react";
import { useActionState } from "react";
import { echoMarkdown } from "@/app/(main)/ui/actions";
import { Editor } from "@/components/forum/editor";
import { LitePlaceholder } from "@/components/forum/lite-placeholder";
import { MarkdownContent } from "@/components/forum/markdown-content";
import { Button } from "@/components/ui/button";

export function EditorDemoClient({ lite }: { lite: boolean }) {
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
          <MarkdownContent
            images={
              lite
                ? {
                    img: () => (
                      <LitePlaceholder className="inline-flex min-h-10 w-full" />
                    ),
                  }
                : undefined
            }
          >
            {markdown}
          </MarkdownContent>
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
