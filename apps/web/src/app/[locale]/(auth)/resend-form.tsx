"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import {
  type FormState,
  resendVerification,
} from "@/app/[locale]/(auth)/actions";
import { HydrationMark } from "@/app/[locale]/(auth)/hydration-mark";
import { FormError } from "@/components/forum/form-error";
import { TurnstileField } from "@/components/forum/turnstile-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ResendForm({
  from,
  email,
  turnstileKey,
  refusal,
}: {
  from: "login" | "verify";
  email?: string;
  turnstileKey: string | null;
  // What a form sent without the page's script was refused for (see `native-form.ts`).
  refusal?: string;
}) {
  const t = useTranslations("auth.resendForm");
  const [state, action, pending] = useActionState<FormState, FormData>(
    resendVerification,
    refusal ? { error: refusal } : null,
  );
  return (
    <form action={action} className="space-y-4">
      <HydrationMark />
      <input type="hidden" name="from" value={from} />
      <div className="space-y-2">
        <Label htmlFor={`resend-email-${from}`}>{t("emailLabel")}</Label>
        <Input
          id={`resend-email-${from}`}
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={email}
          required
          aria-invalid={state ? true : undefined}
          aria-describedby={state ? `resend-error-${from}` : undefined}
        />
        {state && (
          <FormError id={`resend-error-${from}`}>{state.error}</FormError>
        )}
      </div>
      {turnstileKey && (
        <TurnstileField
          siteKey={turnstileKey}
          action="resendConfirmation"
          retry={state}
        />
      )}
      <Button
        type="submit"
        variant="outline"
        disabled={pending}
        className="h-10 w-full md:h-8"
      >
        {pending ? t("pending") : t("submit")}
      </Button>
    </form>
  );
}
