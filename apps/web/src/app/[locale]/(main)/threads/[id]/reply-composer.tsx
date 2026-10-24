"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { QUOTE_EVENT } from "@/app/[locale]/(main)/threads/[id]/quote";
import { AttachmentField } from "@/components/forum/attachment-field";
import { ComposerButtons } from "@/components/forum/composer-buttons";
import { FormError } from "@/components/forum/form-error";
import { QuickReplyEditor } from "@/components/forum/quick-reply-editor";
import { SelectionQuote } from "@/components/forum/selection-quote";
import type { KeptState } from "@/components/forum/use-kept-form";
import { useTailForm } from "@/components/forum/use-tail-form";
import type { TailRow } from "@/lib/tail";

// Whether a reply is on its way to a page that will be drawn anew (the form is gone with it): the
// new form takes the focus back, so the member can go on writing.
let sending = false;

// The quick reply at the end of a thread or a conversation, the same form for both, as XenForo's:
// the editor (which takes what a post's or message's Quote, or a selection's, sends), then
// "Attach files" and the submit on one row. A reply that is taken shows at the end of the page at
// once and the form starts over, with the focus back in it; a refused one stays in the form. The
// page hands it the sends of what is answered, bound to it: the thread's, or the conversation's.
export function ReplyComposer({
  replyInPlace,
  replyAction,
  tailKey,
  files,
  placeholder,
  submitLabel,
}: {
  // The send that answers with the reply drawn for the end of the page (`lib/tail`).
  replyInPlace: (data: FormData) => Promise<{ error?: string; row?: TailRow }>;
  // The send of a page that does not show the end: it goes there.
  replyAction: (previous: KeptState, data: FormData) => Promise<KeptState>;
  // Where the end of the last page is kept while it is open.
  tailKey: string;
  // Where files are uploaded (a thread's forum by `nodeId`, a conversation's without one), when
  // the viewer may attach files there.
  files: { nodeId?: number } | null;
  placeholder: string;
  submitLabel: string;
}) {
  const tFailed = useTranslations("lib.errors");
  const { state, pending, generation, onSubmit } = useTailForm({
    send: replyInPlace,
    redirecting: replyAction,
    tailKey,
    failed: tFailed("generic"),
  });
  const [uploading, setUploading] = useState(false);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!sending) return;
    sending = false;
    form.current?.querySelector("textarea")?.focus();
  }, []);

  // The answer came to this same form (a refusal, or a reply taken in place): nothing is drawn
  // anew, so no new form is waiting for the focus.
  useEffect(() => {
    if (!pending) sending = false;
  }, [pending]);

  // A reply taken in place empties the form, and the member goes on writing.
  useEffect(() => {
    if (generation > 0) form.current?.querySelector("textarea")?.focus();
  }, [generation]);

  return (
    <>
      <form
        ref={form}
        onSubmit={(event) => {
          sending = true;
          onSubmit(event);
        }}
        data-shortcut="reply"
        className="space-y-3"
      >
        <QuickReplyEditor generation={generation} placeholder={placeholder} />
        {state.error && <FormError>{state.error}</FormError>}
        <ComposerButtons
          submitLabel={submitLabel}
          order="reply"
          disabled={pending || uploading}
          files={
            files && (
              <AttachmentField
                key={`files-${generation}`}
                compact
                nodeId={files.nodeId}
                onBusy={setUploading}
              />
            )
          }
        />
      </form>
      <SelectionQuote event={QUOTE_EVENT} />
    </>
  );
}
