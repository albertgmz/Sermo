"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { type FormState, resendVerification } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ResendForm({
  from,
  email,
}: {
  from: "login" | "verify";
  email?: string;
}) {
  const t = useTranslations("auth.resendForm");
  const [state, action, pending] = useActionState<FormState, FormData>(
    resendVerification,
    null,
  );
  return (
    <form action={action} className="space-y-4">
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
          <p
            id={`resend-error-${from}`}
            role="alert"
            className="text-sm text-destructive"
          >
            {state.error}
          </p>
        )}
      </div>
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
