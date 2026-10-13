"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { choosePassword, type FormState } from "@/app/(auth)/actions";
import { PasswordField } from "@/app/(auth)/password-field";
import { PasswordStrength } from "@/app/(auth)/password-strength";
import { FormError } from "@/components/forum/form-error";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export function ResetForm({ token }: { token: string }) {
  const t = useTranslations("auth.resetPassword");
  const [state, action, pending] = useActionState<FormState, FormData>(
    choosePassword,
    null,
  );
  const [password, setPassword] = useState("");
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <div className="space-y-2">
        <Label htmlFor="reset-password">{t("passwordLabel")}</Label>
        <PasswordField
          id="reset-password"
          autoComplete="new-password"
          required
          onValueChange={setPassword}
        />
        <PasswordStrength password={password} />
        <p className="text-xs text-muted-foreground">{t("hint")}</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="reset-confirm">{t("confirmLabel")}</Label>
        <PasswordField
          id="reset-confirm"
          name="confirm"
          autoComplete="new-password"
          required
        />
      </div>
      {state && <FormError>{state.error}</FormError>}
      <Button type="submit" disabled={pending} className="h-10 w-full md:h-8">
        {pending ? t("pending") : t("submit")}
      </Button>
    </form>
  );
}
