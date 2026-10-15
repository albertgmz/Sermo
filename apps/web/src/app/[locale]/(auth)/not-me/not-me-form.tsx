"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import type { FormState } from "@/app/[locale]/(auth)/actions";
import { confirmNotMe } from "@/app/[locale]/(auth)/not-me/actions";
import { FormError } from "@/components/forum/form-error";
import { Button } from "@/components/ui/button";

export function NotMeForm({ token }: { token: string }) {
  const t = useTranslations("auth.notMe");
  const [state, action, pending] = useActionState<FormState, FormData>(
    confirmNotMe,
    null,
  );
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      {state && <FormError>{state.error}</FormError>}
      <Button type="submit" disabled={pending} className="h-10 w-full md:h-8">
        {pending ? t("pending") : t("submit")}
      </Button>
    </form>
  );
}
