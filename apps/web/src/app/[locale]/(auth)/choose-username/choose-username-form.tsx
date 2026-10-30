"use client";

import type { RegistrationField } from "@sermo/core/contracts";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { chooseUsername } from "@/app/[locale]/(auth)/actions";
import { HydrationMark } from "@/app/[locale]/(auth)/hydration-mark";
import {
  TermsField,
  UsernameField,
} from "@/app/[locale]/(auth)/register/account-fields";
import { SignupFields } from "@/app/[locale]/(auth)/register/signup-fields";
import { FormError } from "@/components/forum/form-error";
import { Button } from "@/components/ui/button";

// The username screen's form: the sign-up form's username field, filled in with the name the
// account was given for now, the profile fields the site asks at sign-up, and its terms checkbox.
export function ChooseUsernameForm({
  username,
  next,
  pages,
  fields,
  minimumAge,
  refusal = "",
}: {
  username: string;
  next: string;
  pages: "both" | "terms" | "rules" | "none";
  fields: readonly RegistrationField[];
  minimumAge: number;
  // What a form sent without the page's script was refused for (see `native-form.ts`).
  refusal?: string;
}) {
  const t = useTranslations("auth.chooseUsername");
  const [state, action, pending] = useActionState(chooseUsername, {
    error: refusal,
    username,
  });
  return (
    <form action={action} className="space-y-4">
      <HydrationMark />
      <input type="hidden" name="next" value={next} />
      <UsernameField defaultValue={state.username} />
      <SignupFields
        fields={fields}
        minimumAge={minimumAge}
        kept={state.profile ?? {}}
      />
      <TermsField pages={pages} newTab />
      {state.error && <FormError>{state.error}</FormError>}
      <Button type="submit" disabled={pending} className="h-10 w-full md:h-8">
        {t("submit")}
      </Button>
    </form>
  );
}
