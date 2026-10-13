"use client";

import { Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { replyAction } from "@/app/(main)/conversations/actions";
import { AttachmentField } from "@/components/forum/attachment-field";
import { LazyEditor } from "@/components/forum/lazy-editor";
import { useKeptForm } from "@/components/forum/use-kept-form";
import { Button } from "@/components/ui/button";

// Whether a message is on its way. A message that is taken ends in a redirect, which draws this
// form anew and empty; the new form then takes the focus back, so the member can go on writing.
let sending = false;

export function ReplyForm({
  conversationId,
  placeholder,
  submitLabel,
}: {
  conversationId: number;
  placeholder: string;
  submitLabel: string;
}) {
  // A refused message stays in the form, files included: the form is not reset by its action.
  const { state, pending, onSubmit } = useKeptForm(
    replyAction.bind(null, conversationId),
  );
  const [uploading, setUploading] = useState(false);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!sending) return;
    sending = false;
    form.current?.querySelector("textarea")?.focus();
  }, []);

  // The refusal was answered to this same form: nothing is drawn anew.
  useEffect(() => {
    if (state.error) sending = false;
  }, [state]);

  return (
    <form
      ref={form}
      onSubmit={(event) => {
        sending = true;
        onSubmit(event);
      }}
      className="space-y-3 rounded-lg border bg-card p-3 md:p-4"
    >
      <LazyEditor name="body" placeholder={placeholder} minHeight={96} />
      <AttachmentField onBusy={setUploading} />
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={pending || uploading}
          className="h-10 px-4"
        >
          <Send />
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
