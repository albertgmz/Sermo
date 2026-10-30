"use client";

import type { RegistrationField } from "@sermo/core/contracts";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { register } from "@/app/[locale]/(auth)/actions";
import { HydrationMark } from "@/app/[locale]/(auth)/hydration-mark";
import { PasswordField } from "@/app/[locale]/(auth)/password-field";
import { PasswordStrength } from "@/app/[locale]/(auth)/password-strength";
import {
  Required,
  TermsField,
  UsernameField,
} from "@/app/[locale]/(auth)/register/account-fields";
import { SignupFields } from "@/app/[locale]/(auth)/register/signup-fields";
import { useHardNavigation } from "@/app/[locale]/(auth)/use-hard-navigation";
import { FormError } from "@/components/forum/form-error";
import { TurnstileField } from "@/components/forum/turnstile-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function RegisterForm({
  referrer,
  turnstileKey,
  pages,
  fields,
  minimumAge,
  refusal = "",
}: {
  referrer?: string;
  turnstileKey: string | null;
  // The profile fields the site asks at sign-up (its registration settings), and the youngest age
  // that may register (0: none).
  fields: readonly RegistrationField[];
  minimumAge: number;
  // Which of the terms and the rules the site publishes: the checkbox names only those.
  pages: "both" | "terms" | "rules" | "none";
  // What a form sent without the page's script was refused for (see `native-form.ts`).
  refusal?: string;
}) {
  const t = useTranslations("auth.registerForm");
  const [state, action, pending] = useActionState(register, {
    error: refusal,
    username: "",
  });
  const [password, setPassword] = useState("");
  useHardNavigation(state.assign);

  return (
    <form action={action} className="space-y-4">
      <HydrationMark />
      {referrer && <input type="hidden" name="ref" value={referrer} />}
      <UsernameField defaultValue={state.username} />
      <div className="space-y-2">
        <Label htmlFor="register-email">
          {t.rich("emailLabel", {
            required: (chunks) => <Required>{chunks}</Required>,
          })}
        </Label>
        <Input
          id="register-email"
          name="email"
          type="email"
          autoComplete="email"
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="register-password">
          {t.rich("passwordLabel", {
            required: (chunks) => <Required>{chunks}</Required>,
          })}
        </Label>
        <PasswordField
          id="register-password"
          autoComplete="new-password"
          required
          onValueChange={setPassword}
        />
        <PasswordStrength password={password} />
      </div>
      <SignupFields
        fields={fields}
        minimumAge={minimumAge}
        kept={state.profile ?? {}}
      />
      {turnstileKey && (
        <TurnstileField
          siteKey={turnstileKey}
          action="register"
          retry={state}
        />
      )}
      {state.error && <FormError>{state.error}</FormError>}
      <Button type="submit" disabled={pending} className="h-10 w-full md:h-8">
        {t("submit")}
      </Button>
      <TermsField pages={pages} />
    </form>
  );
}
