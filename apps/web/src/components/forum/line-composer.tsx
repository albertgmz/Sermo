"use client";

import { SendHorizontal } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { AttachmentField } from "@/components/forum/attachment-field";
import { FormError } from "@/components/forum/form-error";
import { LazyEditor } from "@/components/forum/lazy-editor";
import { PendingButton } from "@/components/forum/pending-button";
import { landOn } from "@/components/layout/land-on";
import { cn } from "@/lib/utils";

// `landOn`: the hash of what was just written, which the page then lands on.
export type LineComposerState = { error?: string; landOn?: string };

// The one-line composer for answering where the item is read: the comments of a wall post, a
// reply from a feed card. The backend's refusal is shown as it comes. With `attach` the line
// takes files too (a paperclip in its row, the chosen files on a line above).
export function LineComposer({
  action,
  placeholder,
  submitLabel,
  attach = false,
  className,
}: {
  action: (
    previous: LineComposerState,
    formData: FormData,
  ) => Promise<LineComposerState>;
  placeholder: string;
  submitLabel: string;
  attach?: boolean;
  className?: string;
}) {
  const [state, formAction] = useActionState(action, {});
  const [uploading, setUploading] = useState(false);
  useEffect(() => {
    if (state.landOn) landOn(state.landOn);
  }, [state]);
  return (
    <form action={formAction} className={cn("space-y-2", className)}>
      <div className={cn("flex items-end gap-2", attach && "flex-wrap")}>
        {attach && <AttachmentField compact onBusy={setUploading} />}
        <LazyEditor
          name="body"
          placeholder={placeholder}
          className="flex-1 rounded-4xl"
        />
        <PendingButton
          size="icon"
          aria-label={submitLabel}
          className="size-10"
          disabled={uploading}
        >
          <SendHorizontal />
        </PendingButton>
      </div>
      {state.error && <FormError>{state.error}</FormError>}
    </form>
  );
}
