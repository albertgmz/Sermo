"use client";

import { SendHorizontal } from "lucide-react";
import { useActionState } from "react";
import { FormError } from "@/components/forum/form-error";
import { LazyEditor } from "@/components/forum/lazy-editor";
import { PendingButton } from "@/components/forum/pending-button";
import { cn } from "@/lib/utils";

export type LineComposerState = { error?: string };

// The one-line composer for answering where the item is read: the comments of a wall post, a
// reply from a feed card. The backend's refusal is shown as it comes.
export function LineComposer({
  action,
  placeholder,
  submitLabel,
  className,
}: {
  action: (
    previous: LineComposerState,
    formData: FormData,
  ) => Promise<LineComposerState>;
  placeholder: string;
  submitLabel: string;
  className?: string;
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className={cn("space-y-2", className)}>
      <div className="flex items-end gap-2">
        <LazyEditor
          name="body"
          placeholder={placeholder}
          className="flex-1 rounded-4xl"
        />
        <PendingButton size="icon" aria-label={submitLabel} className="size-10">
          <SendHorizontal />
        </PendingButton>
      </div>
      {state.error && <FormError>{state.error}</FormError>}
    </form>
  );
}
