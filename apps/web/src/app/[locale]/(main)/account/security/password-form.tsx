"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { PasswordField } from "@/app/[locale]/(auth)/password-field";
import { PasswordStrength } from "@/app/[locale]/(auth)/password-strength";
import {
  type FormState,
  updatePassword,
} from "@/app/[locale]/(main)/account/security/actions";
import { rowClass } from "@/app/[locale]/(main)/account/security/form-rows";
import { PendingButton } from "@/components/forum/pending-button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

export function PasswordForm() {
  const t = useTranslations("account.security.password");
  const [state, action] = useActionState<FormState, FormData>(
    updatePassword,
    null,
  );
  const [password, setPassword] = useState("");

  return (
    <form action={action}>
      <div className="divide-y">
        <div className={rowClass}>
          <Label htmlFor="security-current" className="self-start sm:pt-3">
            {t("currentLabel")}
          </Label>
          <div className="min-w-0">
            <PasswordField
              id="security-current"
              name="currentPassword"
              autoComplete="current-password"
              required
            />
          </div>
        </div>
        <div className={rowClass}>
          <Label htmlFor="security-new" className="self-start sm:pt-3">
            {t("newLabel")}
          </Label>
          <div className="min-w-0 space-y-2">
            <PasswordField
              id="security-new"
              name="newPassword"
              autoComplete="new-password"
              required
              onValueChange={setPassword}
            />
            <PasswordStrength password={password} />
            <p className="text-xs text-muted-foreground">{t("newHint")}</p>
          </div>
        </div>
        <div className={rowClass}>
          <Label htmlFor="security-confirm" className="self-start sm:pt-3">
            {t("confirmLabel")}
          </Label>
          <div className="min-w-0">
            <PasswordField
              id="security-confirm"
              name="confirmPassword"
              autoComplete="new-password"
              required
            />
          </div>
        </div>
        <div className="flex min-h-10 items-start gap-3 p-4">
          <Checkbox id="security-revoke" name="revokeOthers" defaultChecked />
          <Label
            htmlFor="security-revoke"
            className="block leading-normal font-normal text-muted-foreground"
          >
            {t("signOutOthers")}
          </Label>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t p-4">
        <PendingButton className="min-h-10 px-4">{t("submit")}</PendingButton>
        <output className="text-xs font-medium text-destructive empty:hidden">
          {state?.error}
        </output>
      </div>
    </form>
  );
}
