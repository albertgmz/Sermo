"use client";

import { useTranslations } from "next-intl";
import { use, useEffect, useRef, useState } from "react";
import { findRecipients } from "@/app/[locale]/(main)/conversations/actions";
import {
  ActionForm,
  type ActionFormState,
} from "@/components/forum/action-form";
import { ClosePanel } from "@/components/forum/content-actions";
import { FormError } from "@/components/forum/form-error";
import { LazyEditor } from "@/components/forum/lazy-editor";
import { landOn } from "@/components/layout/land-on";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

// Edits an item where it is read: it asks for the BB code the item was written in when it opens
// (the lists only carry the rendered text) and shows the editor on it. A saved edit reports
// `done`: the panel closes and the refreshed page shows the item anew, landing on it when
// `target` names it (`#profile-comment-5`).
export function InlineEditForm({
  load,
  action,
  placeholder,
  target,
}: {
  load: () => Promise<string | null>;
  action: (
    previous: ActionFormState,
    formData: FormData,
  ) => Promise<ActionFormState>;
  placeholder: string;
  target?: string;
}) {
  const t = useTranslations("forum.contentActions");
  const close = use(ClosePanel);
  const saveAndClose: typeof action = async (previous, formData) => {
    const state = await action(previous, formData);
    if (state.done) {
      close();
      if (target) landOn(target);
    }
    return state;
  };
  const [source, setSource] = useState<string | null>();
  const asked = useRef(load);
  useEffect(() => {
    let current = true;
    asked.current().then((text) => current && setSource(text));
    return () => {
      current = false;
    };
  }, []);

  if (source === undefined) return <Skeleton className="h-10 w-full" />;
  if (source === null) return <FormError>{t("sourceFailed")}</FormError>;
  return (
    <ActionForm
      action={saveAndClose}
      submit={t("save")}
      variant="default"
      aside={
        <Button
          type="button"
          variant="ghost"
          className="h-10 px-3"
          onClick={close}
        >
          {t("cancel")}
        </Button>
      }
    >
      <LazyEditor
        name="body"
        placeholder={placeholder}
        defaultValue={source}
        minHeight={80}
        findMembers={findRecipients}
      />
    </ActionForm>
  );
}
