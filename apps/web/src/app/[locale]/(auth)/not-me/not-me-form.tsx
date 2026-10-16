"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import type { FormState } from "@/app/[locale]/(auth)/actions";
import { HydrationMark } from "@/app/[locale]/(auth)/hydration-mark";
import { confirmNotMe } from "@/app/[locale]/(auth)/not-me/actions";
import { FormError } from "@/components/forum/form-error";
import { Button } from "@/components/ui/button";

export function NotMeForm({
  token,
  refusal,
}: {
  token: string;
  // What a form sent without the page's script was refused for (see `native-form.ts`).
  refusal?: string;
}) {
  const t = useTranslations("auth.notMe");
  const [state, action, pending] = useActionState<FormState, FormData>(
    confirmNotMe,
    refusal ? { error: refusal } : null,
  );
  return (
    <form action={action} className="space-y-4">
      <HydrationMark />
      <input type="hidden" name="token" value={token} />
      {state && <FormError>{state.error}</FormError>}
      <Button type="submit" disabled={pending} className="h-10 w-full md:h-8">
        {pending ? t("pending") : t("submit")}
      </Button>
    </form>
  );
}
