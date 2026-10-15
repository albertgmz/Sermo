"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { type FormState, forgotPassword } from "@/app/[locale]/(auth)/actions";
import { TurnstileField } from "@/app/[locale]/(auth)/turnstile-field";
import { FormError } from "@/components/forum/form-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ForgotForm({ turnstileKey }: { turnstileKey: string | null }) {
  const t = useTranslations("auth.forgotPassword");
  const [state, action, pending] = useActionState<FormState, FormData>(
    forgotPassword,
    null,
  );
  return (
    <form action={action} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="forgot-email">{t("emailLabel")}</Label>
        <Input
          id="forgot-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={state ? true : undefined}
          aria-describedby={state ? "forgot-error" : undefined}
        />
        {state && <FormError id="forgot-error">{state.error}</FormError>}
      </div>
      {turnstileKey && <TurnstileField siteKey={turnstileKey} retry={state} />}
      <Button type="submit" disabled={pending} className="h-10 w-full md:h-8">
        {pending ? t("pending") : t("submit")}
      </Button>
    </form>
  );
}
