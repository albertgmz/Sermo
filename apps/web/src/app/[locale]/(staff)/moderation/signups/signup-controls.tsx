"use client";

import { useTranslations } from "next-intl";
import { useActionState, useId, useState } from "react";
import { FormError } from "@/components/forum/form-error";
import { ConfirmPassword } from "@/components/staff/confirm-password";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { SubmitButton } from "@/components/staff/submit-button";
import { decideSignups } from "./actions";

const MODES = ["delete", "ban"] as const;

// What rejecting does to the account, and the password that erasing asks for.
function RejectChoice() {
  const t = useTranslations("moderation.signups.reject");
  const id = useId();
  const [mode, setMode] = useState<(typeof MODES)[number]>("delete");
  return (
    <>
      <fieldset className="space-y-1">
        <legend className="mb-1 text-xs font-medium">{t("modeLabel")}</legend>
        {MODES.map((value) => (
          <label key={value} className="flex min-h-10 items-start gap-3 py-1">
            <input
              type="radio"
              name="mode"
              value={value}
              checked={mode === value}
              onChange={() => setMode(value)}
              className="mt-0.5 size-5 shrink-0"
            />
            <span className="min-w-0 text-sm">
              <span className="block font-medium">{t(`mode.${value}`)}</span>
              <span className="block text-xs text-pretty text-muted-foreground">
                {t(`modeHelp.${value}`)}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      {mode === "delete" && <ConfirmPassword id={`${id}-password`} />}
    </>
  );
}

function ApproveForm({ ids }: { ids: string }) {
  const t = useTranslations("moderation.signups");
  const [state, action] = useActionState(decideSignups, null);
  return (
    <form action={action} className="space-y-1">
      <input type="hidden" name="decision" value="approve" />
      <input type="hidden" name="userIds" value={ids} />
      <SubmitButton
        label={t("approve")}
        pendingLabel={t("approving")}
        variant="outline"
      />
      {state?.error && <FormError>{state.error}</FormError>}
    </form>
  );
}

// Approve and reject for the sign-ups named: one row's, or the ticked rows'. Both end in a
// redirect back to the queue with what the backend did.
export function DecideControls({ userIds }: { userIds: readonly number[] }) {
  const t = useTranslations("moderation.signups");
  const ids = userIds.join(",");
  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
      <ApproveForm ids={ids} />
      <ConfirmStep
        action={decideSignups}
        fields={{ decision: "reject", userIds: ids }}
        summary={t("reject.summary")}
        submit={t("reject.submit")}
        pendingLabel={t("reject.pending")}
        warning={t("reject.warning")}
        reason={t("reject.reason")}
      >
        <RejectChoice />
      </ConfirmStep>
    </div>
  );
}
