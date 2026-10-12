"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import {
  type FormState,
  updateEmail,
} from "@/app/(main)/account/security/actions";
import { rowClass } from "@/app/(main)/account/security/form-rows";
import { PendingButton } from "@/components/forum/pending-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function EmailChangeForm() {
  const t = useTranslations("account.security.email");
  const [state, action] = useActionState<FormState, FormData>(
    updateEmail,
    null,
  );
  return (
    <form action={action}>
      <div className={rowClass}>
        <Label htmlFor="security-new-email" className="self-start sm:pt-3">
          {t("changeLabel")}
        </Label>
        <div className="min-w-0 space-y-2">
          <Input
            id="security-new-email"
            name="newEmail"
            type="email"
            autoComplete="email"
            required
            aria-invalid={state ? true : undefined}
            aria-describedby="security-new-email-help"
          />
          <p
            id="security-new-email-help"
            className="text-xs text-muted-foreground"
          >
            {t("changeHint")}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t p-4">
        <PendingButton className="min-h-10 px-4">{t("change")}</PendingButton>
        <output className="text-xs font-medium text-destructive empty:hidden">
          {state?.error}
        </output>
      </div>
    </form>
  );
}
