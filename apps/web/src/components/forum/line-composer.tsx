"use client";

import { useActionState, useEffect, useState } from "react";
import { AttachmentField } from "@/components/forum/attachment-field";
import { ComposerButtons } from "@/components/forum/composer-buttons";
import { FormError } from "@/components/forum/form-error";
import { LazyEditor } from "@/components/forum/lazy-editor";
import { findMentions } from "@/components/forum/mention-find";
import { landOn } from "@/components/layout/land-on";
import { cn } from "@/lib/utils";

// `landOn`: the hash of what was just written, which the page then lands on.
export type LineComposerState = { error?: string; landOn?: string };

// The short composer for answering where the item is read: the comments of a wall post, a reply
// from a feed card. Until it is entered it is one line, as XenForo's "Write a comment…" box is;
// entered, the editor takes the whole width with its bar over a taller text, and the labelled
// buttons follow it (`ComposerButtons`). The backend's refusal is shown as it comes. With `attach`
// it is a comment that takes files (a wall post's): XenForo puts the submit first and "Attach
// files" after it there; a reply has its submit at the end of the row.
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
  const [entered, setEntered] = useState(false);
  // What was sent is in the page: the box starts over as one line, the plain field again until it
  // is entered (the editor's code is in the browser by then, so it comes back at once).
  const [sent, setSent] = useState(0);
  useEffect(() => {
    if (!state.landOn) return;
    landOn(state.landOn);
    setEntered(false);
    setSent((count) => count + 1);
  }, [state]);
  return (
    <form
      action={formAction}
      onFocus={() => setEntered(true)}
      className={cn("space-y-2", className)}
    >
      <LazyEditor
        key={sent}
        name="body"
        placeholder={placeholder}
        findMembers={findMentions}
        minHeight={entered ? 100 : 40}
        line
      />
      {state.error && <FormError>{state.error}</FormError>}
      <ComposerButtons
        submitLabel={submitLabel}
        order={attach ? "comment" : "reply"}
        disabled={uploading}
        files={attach && <AttachmentField compact onBusy={setUploading} />}
        className={entered ? undefined : "hidden"}
      />
    </form>
  );
}
