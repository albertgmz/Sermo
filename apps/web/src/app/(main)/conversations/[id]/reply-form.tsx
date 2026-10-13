"use client";

import { SendHorizontal } from "lucide-react";
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
  className,
}: {
  conversationId: number;
  placeholder: string;
  submitLabel: string;
  className?: string;
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

  // The form grows over the messages when the editor takes the place of the line, or a file is
  // added: the page follows, so the newest message stays in view.
  useEffect(() => {
    const element = form.current;
    if (!element) return;
    let height = element.offsetHeight;
    const observer = new ResizeObserver(() => {
      const grown = element.offsetHeight - height;
      height = element.offsetHeight;
      if (grown > 0) window.scrollBy(0, grown);
    });
    observer.observe(element);
    return () => observer.disconnect();
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
      className={className}
    >
      {state.error && (
        <p role="alert" className="mb-2 text-sm text-destructive">
          {state.error}
        </p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <AttachmentField compact onBusy={setUploading} />
        <LazyEditor
          name="body"
          placeholder={placeholder}
          className="flex-1 rounded-4xl"
        />
        <Button
          type="submit"
          size="icon"
          aria-label={submitLabel}
          disabled={pending || uploading}
          className="size-10"
        >
          <SendHorizontal />
        </Button>
      </div>
    </form>
  );
}
