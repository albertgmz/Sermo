"use client";

import { useTranslations } from "next-intl";
import { guestReplyAction } from "@/app/[locale]/(main)/guest-posting/actions";
import { ComposerButtons } from "@/components/forum/composer-buttons";
import { Toolbar } from "@/components/forum/editor-toolbar";
import { FormError } from "@/components/forum/form-error";
import { GuestFields } from "@/components/forum/guest-fields";
import { GuestNotice } from "@/components/forum/guest-notice";
import { LazyEditor } from "@/components/forum/lazy-editor";
import { findMentions } from "@/components/forum/mention-find";
import { useKeptForm } from "@/components/forum/use-kept-form";

// The reply box a guest sees where the forum lets guests reply: the text, the name and the security
// check, and nothing else (no files, no quote). Sending it does not show the reply: it waits for
// a moderator, so the form is replaced by the notice that says so.
export function GuestReplyForm({
  threadId,
  backHref,
  turnstileKey,
  placeholder,
  submitLabel,
}: {
  threadId: number;
  // The thread's address, where the notice leads back to.
  backHref: string;
  turnstileKey: string;
  placeholder: string;
  submitLabel: string;
}) {
  const t = useTranslations("forum.guestPosting");
  const { state, pending, onSubmit } = useKeptForm(
    guestReplyAction.bind(null, threadId),
  );
  if (state.done)
    return <GuestNotice back={{ href: backHref, label: "backToThread" }} />;
  return (
    <form onSubmit={onSubmit} className="space-y-3" data-shortcut="reply">
      <LazyEditor
        bar={Toolbar}
        name="body"
        compact={false}
        placeholder={placeholder}
        findMembers={findMentions}
      />
      <GuestFields
        turnstileKey={turnstileKey}
        nameError={state.nameError}
        retry={state}
      />
      {state.error && <FormError>{state.error}</FormError>}
      <p className="text-xs text-muted-foreground">{t("reviewHint")}</p>
      <ComposerButtons
        submitLabel={submitLabel}
        order="reply"
        disabled={pending}
      />
    </form>
  );
}
