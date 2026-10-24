"use client";

import { SquarePen } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { guestThreadAction } from "@/app/[locale]/(main)/guest-posting/actions";
import { ComposerForm, ComposerPage } from "@/components/forum/composer";
import { Toolbar } from "@/components/forum/editor-toolbar";
import { GuestFields } from "@/components/forum/guest-fields";
import { GuestNotice } from "@/components/forum/guest-notice";
import { findMentions } from "@/components/forum/mention-find";
import { TitleField } from "@/components/forum/thread-fields";
import { useKeptForm } from "@/components/forum/use-kept-form";
import type { PrefixView } from "@/lib/sermo/views";

// Starting a thread as a guest: the member's composer without what a guest cannot add (the choice
// of another forum, files, a poll, tags, watching and the draft kept in the tab), with the name and
// the security check under the text. The thread waits for a moderator, so what follows a send is the
// notice that says so, not the thread.
export function GuestThreadComposer({
  forumId,
  prefixes,
  requirePrefix,
  turnstileKey,
}: {
  forumId: number;
  prefixes: PrefixView[];
  requirePrefix: boolean;
  turnstileKey: string;
}) {
  const t = useTranslations("forum.threadComposer");
  const tFields = useTranslations("forum.threadFields");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [prefix, setPrefix] = useState("");
  const { state, pending, onSubmit } = useKeptForm(
    guestThreadAction.bind(null, forumId),
  );
  if (state.done)
    return (
      <GuestNotice
        back={{ href: `/forums/${forumId}`, label: "backToForum" }}
      />
    );
  return (
    <ComposerPage>
      <ComposerForm
        onSubmit={onSubmit}
        frame={{ kind: "page", closeHref: `/forums/${forumId}` }}
        submitLabel={t("post")}
        submitIcon={SquarePen}
        pending={pending}
        canSubmit={
          title.trim() !== "" &&
          body.trim() !== "" &&
          !(requirePrefix && prefix === "")
        }
        top={
          <div className="space-y-3 px-3 pt-3 pb-3 md:px-4 md:pt-4">
            <TitleField
              look="large"
              prefixes={prefixes}
              prefix={prefix}
              onPrefix={setPrefix}
              none={tFields("noPrefix")}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              aria-label={t("titleLabel")}
              placeholder={t("titlePlaceholder")}
            />
            {prefixes.length > 0 && (
              <input type="hidden" name="prefixId" value={prefix} />
            )}
            {requirePrefix && !prefix && (
              <p className="text-xs text-muted-foreground">
                {t("prefixRequired")}
              </p>
            )}
          </div>
        }
        below={
          <div className="px-3 pt-3 pb-4 md:px-4">
            <GuestFields
              turnstileKey={turnstileKey}
              nameError={state.nameError}
              retry={state}
            />
          </div>
        }
        boxed
        attach={false}
        error={state.error}
        placeholder={t("bodyPlaceholder")}
        minHeight={200}
        findMembers={findMentions}
        onBodyChange={setBody}
        bar={Toolbar}
      />
    </ComposerPage>
  );
}
