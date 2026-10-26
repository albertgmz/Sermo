"use client";

// PromotionApply: the control that changes one promotion for the member by hand: a choice of
// what to do, the administrator's own password (the change alters the member's groups) and a
// button. The backend's answer comes back under it.

import { useTranslations } from "next-intl";
import { useActionState, useId } from "react";
import { ConfirmPassword } from "@/components/staff/confirm-password";
import type { StaffFormState } from "@/components/staff/form-rows";
import { selectClass } from "@/components/staff/rows";
import { SubmitButton } from "@/components/staff/submit-button";

export function PromotionApply({
  action,
  actions,
  userId,
  promotionId,
}: {
  action: (
    previous: StaffFormState,
    formData: FormData,
  ) => Promise<StaffFormState>;
  // The actions the backend offers, in its order (the contract's list).
  actions: readonly string[];
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
          {actions.map((value) => (
            <option key={value} value={value}>
              {t(`actions.${value as "promote"}`)}
            </option>
          ))}
        </select>
        <SubmitButton label={t("apply")} />
      </div>
      <ConfirmPassword
        id={`apply-password-${promotionId}`}
        error={state?.fields?.actorPassword}
      />
      <p
        role="status"
        className="block text-xs font-medium text-destructive [overflow-wrap:anywhere] empty:hidden"
      >
        {state?.error}
      </p>
    </form>
  );
}
