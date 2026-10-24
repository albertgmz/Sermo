"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { replyAction } from "@/app/[locale]/(main)/conversations/actions";
import { replyInPlace } from "@/app/[locale]/(main)/conversations/reply-in-place";
import { QUOTE_EVENT } from "@/app/[locale]/(main)/threads/[id]/quote";
import { AttachmentField } from "@/components/forum/attachment-field";
import { ComposerButtons } from "@/components/forum/composer-buttons";
import { FormError } from "@/components/forum/form-error";
import { LazyEditor } from "@/components/forum/lazy-editor";
import { findMentions } from "@/components/forum/mention-find";
import { SelectionQuote } from "@/components/forum/selection-quote";
import { useTailForm } from "@/components/forum/use-tail-form";

// Whether a message is on its way to a page that will be drawn anew (the form is gone with it): the
// new form takes the focus back, so the member can go on writing.
let sending = false;

export function ReplyForm({
  conversationId,
  tailKey,
  placeholder,
  submitLabel,
  canAttach = true,
}: {
  conversationId: number;
  // Where the end of the conversation is kept while the newest page is open.
  tailKey: string;
  placeholder: string;
  submitLabel: string;
  // Whether the viewer's groups allow attaching files to messages (`conversation.attach`).
  canAttach?: boolean;
}) {
  const t = useTranslations("lib.errors");
  // A refused message stays in the form, files included: the form is not reset by its action. A
  // message that is taken shows in the conversation at once and the form starts over.
  const { state, pending, generation, onSubmit } = useTailForm({
    tailKey,
    send: replyInPlace.bind(null, conversationId),
    redirecting: replyAction.bind(null, conversationId),
    failed: t("generic"),
  });
  const [uploading, setUploading] = useState(false);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!sending) return;
    sending = false;
    form.current?.querySelector("textarea")?.focus();
  }, []);

  // The answer came to this same form (a refusal, or a message taken in place): nothing is drawn
  // anew, so no new form is waiting for the focus.
  useEffect(() => {
    if (!pending) sending = false;
  }, [pending]);

  // A message taken in place empties the form, and the member goes on writing.
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
        className="space-y-3 rounded-lg border bg-card p-3 md:p-4"
      >
        {/* The thread's quick reply: the editor takes what a message's Reply quotes; under it,
          "Attach files" and the submit on one row, as XenForo's. */}
        <LazyEditor
          key={`editor-${generation}`}
          name="body"
          compact={false}
          placeholder={placeholder}
          findMembers={findMentions}
          insertEvent={QUOTE_EVENT}
        />
        {state.error && <FormError>{state.error}</FormError>}
        <ComposerButtons
          submitLabel={submitLabel}
          order="reply"
          disabled={pending || uploading}
          files={
            canAttach && (
              <AttachmentField
                key={`files-${generation}`}
                compact
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
