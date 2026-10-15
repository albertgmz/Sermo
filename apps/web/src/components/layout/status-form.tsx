"use client";

import { SendHorizontal } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { FormError } from "@/components/forum/form-error";
import { PendingButton } from "@/components/forum/pending-button";
import type { StatusState } from "@/components/layout/status-action";
import { Input } from "@/components/ui/input";

// The line at the bottom of the avatar menu: what is typed is posted on the member's own wall. A
// refused post keeps its text; a posted one clears it and says where it went.
export function StatusForm({
  action,
  wallHref,
}: {
  action: (previous: StatusState, formData: FormData) => Promise<StatusState>;
  wallHref: string;
}) {
  const t = useTranslations("layout.userMenu.status");
  const [text, setText] = useState("");
  const [state, formAction] = useActionState(
    async (previous: StatusState, formData: FormData) => {
      const next = await action(previous, formData);
      if (next.posted) setText("");
      return next;
    },
    {},
  );
  return (
    <form action={formAction} className="space-y-2 border-t p-3">
      <div className="flex items-center gap-2">
        <Input
          name="body"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={t("placeholder")}
          aria-label={t("label")}
          autoComplete="off"
        />
        <PendingButton
          size="icon"
          aria-label={t("submit")}
          disabled={text.trim() === ""}
          className="size-10 shrink-0 md:size-8"
        >
          <SendHorizontal />
        </PendingButton>
      </div>
      {state.error && <FormError className="text-xs">{state.error}</FormError>}
      {state.posted && text === "" && (
        <p role="status" className="text-xs text-muted-foreground">
          {t("posted")}{" "}
          <Link href={wallHref} className="underline underline-offset-4">
            {t("view")}
          </Link>
        </p>
      )}
    </form>
  );
}
