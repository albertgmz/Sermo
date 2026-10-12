"use client";

import { useActionState, useState } from "react";
import { previewForum } from "@/app/(main)/admin/actions";
import { FormFooter } from "@/app/(main)/admin/form-footer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function ForumForm({
  id,
  title,
  description,
}: {
  id: number;
  title: string;
  description: string;
}) {
  const [state, action, pending] = useActionState(
    previewForum.bind(null, id),
    null,
  );
  const [name, setName] = useState(title);
  const [summary, setSummary] = useState(description);
  const [identifier, setIdentifier] = useState("");

  return (
    <form action={action} aria-busy={pending} className="space-y-5 p-4">
      <fieldset
        disabled={pending}
        className="min-w-0 space-y-5 disabled:opacity-60"
      >
        <div className="space-y-2">
          <Label htmlFor="forum-title">Forum name</Label>
          <Input
            id="forum-title"
            name="title"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            minLength={2}
            maxLength={80}
            aria-invalid={state?.field === "title"}
            aria-describedby={
              state?.field === "title" ? "form-error" : undefined
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="forum-description">Description</Label>
          <Textarea
            id="forum-description"
            name="description"
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            required
            maxLength={300}
            rows={3}
            aria-invalid={state?.field === "description"}
            aria-describedby={
              state?.field === "description" ? "form-error" : undefined
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="forum-identifier">URL identifier</Label>
          <Input
            id="forum-identifier"
            name="identifier"
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            placeholder={`Default: ${id}`}
            maxLength={64}
            pattern="[a-z][a-z0-9]*(?:-[a-z0-9]+)*"
            title="Start with a lowercase letter. Use lowercase letters, numbers and single hyphens."
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={state?.field === "identifier"}
            aria-describedby={`identifier-help${state?.field === "identifier" ? " form-error" : ""}`}
          />
          <p id="identifier-help" className="text-xs text-muted-foreground">
            Leave blank to use the numeric ID ({id}). For a custom identifier,
            start with a lowercase letter and use letters, numbers and single
            hyphens.
          </p>
          <div className="rounded-md border bg-muted/50 p-3">
            <p className="text-xs font-medium text-muted-foreground">
              Resulting URL preview
            </p>
            <output
              htmlFor="forum-identifier"
              className="mt-1 block break-all font-mono text-sm"
            >
              /forums/
              {identifier.trim() ? encodeURIComponent(identifier.trim()) : id}
            </output>
          </div>
        </div>
      </fieldset>
      <FormFooter state={state} pending={pending} />
    </form>
  );
}
