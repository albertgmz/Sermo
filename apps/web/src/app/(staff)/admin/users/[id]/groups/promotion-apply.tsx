"use client";

// PromotionApply: the control that changes one promotion for the member by hand: a choice of
// what to do, the administrator's own password (the change alters the member's groups) and a
// button. The backend's answer comes back under it.

import { useTranslations } from "next-intl";
import { useActionState, useId } from "react";
import { useFormStatus } from "react-dom";
import { ConfirmPassword } from "@/components/staff/confirm-password";
import type { StaffFormState } from "@/components/staff/form-rows";
import { selectClass } from "@/components/staff/rows";
import { Button } from "@/components/ui/button";

const ACTIONS = ["promote", "demote", "exempt", "reset"] as const;

function Submit() {
  const t = useTranslations("adminUsers.promotions");
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="min-h-10 px-4">
      {t("apply")}
    </Button>
  );
}

export function PromotionApply({
  action,
  userId,
  promotionId,
}: {
  action: (
    previous: StaffFormState,
    formData: FormData,
  ) => Promise<StaffFormState>;
  userId: number;
  promotionId: number;
}) {
  const t = useTranslations("adminUsers.promotions");
  const [state, formAction] = useActionState(action, null);
  const id = useId();
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="id" value={userId} />
      <input type="hidden" name="promotionId" value={promotionId} />
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={id} className="sr-only">
          {t("action")}
        </label>
        <select id={id} name="action" className={`${selectClass} sm:w-48`}>
          {ACTIONS.map((value) => (
            <option key={value} value={value}>
              {t(`actions.${value}`)}
            </option>
          ))}
        </select>
        <Submit />
      </div>
      <ConfirmPassword
        id={`apply-password-${promotionId}`}
        error={state?.fields?.actorPassword}
      />
      <output className="block text-xs font-medium text-destructive [overflow-wrap:anywhere] empty:hidden">
        {state?.error}
      </output>
    </form>
  );
}
