"use client";

import { Send } from "lucide-react";
import { useActionState } from "react";
import { discard, echoMarkdown } from "@/app/(main)/ui/actions";
import { Editor } from "@/components/forum/editor";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export function EditorDemoClient({ defaultValue }: { defaultValue: string }) {
  const [preview, action, pending] = useActionState(echoMarkdown, null);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <form action={action} className="min-w-0 space-y-3">
        <Label id="sg-editor-label" htmlFor="sg-editor">
          Prefilled, required editor
        </Label>
        <p id="sg-editor-help" className="text-xs text-muted-foreground">
          A real post supplies the initial Markdown. Edit it and submit to
          preview the result without saving a post.
        </p>
        <Editor
          id="sg-editor"
          aria-labelledby="sg-editor-label"
          aria-describedby="sg-editor-help"
          name="body"
          defaultValue={defaultValue}
          required
        />
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
        {preview ? (
          preview
        ) : (
          <p className="text-sm text-muted-foreground">
            Submit the form to see the rendered result. The editor clears itself
            afterwards.
          </p>
        )}
      </div>
      <form action={discard} className="min-w-0 space-y-3">
        <Label id="sg-required-label" htmlFor="sg-required">
          Empty, required editor
        </Label>
        <p id="sg-required-help" className="text-xs text-muted-foreground">
          Submit while empty to see the required message and focus move into the
          editor. Enter text to clear the validation state.
        </p>
        <Editor
          id="sg-required"
          aria-labelledby="sg-required-label"
          aria-describedby="sg-required-help"
          name="body"
          required
        />
        <Button type="submit">Validate required field</Button>
      </form>
      <div className="min-w-0 space-y-3">
        <Label id="sg-editor-invalid-label" htmlFor="sg-editor-invalid">
          Invalid editor
        </Label>
        <Editor
          id="sg-editor-invalid"
          aria-labelledby="sg-editor-invalid-label"
          aria-invalid
          aria-describedby="sg-editor-error"
          defaultValue={defaultValue}
          compact
        />
        <p id="sg-editor-error" className="text-sm text-destructive">
          Example validation error: revise your message before submitting.
        </p>
      </div>
    </div>
  );
}
