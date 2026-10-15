"use client";

import { useTranslations } from "next-intl";
import { useActionState, useId, useState } from "react";
import { FormError } from "@/components/forum/form-error";
import { ConfirmPassword } from "@/components/staff/confirm-password";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { SubmitButton } from "@/components/staff/submit-button";
import { Input } from "@/components/ui/input";
import { decideSignups } from "./actions";
import type { RejectOptions } from "./reject-options";

// What rejecting does to the account, and what each choice keeps. Banning is the default; erasing
// asks for the password. A ban has a length: for good where the viewer may, otherwise days up to
// the bound they hold.
function RejectChoice({ options }: { options: RejectOptions }) {
  const t = useTranslations("moderation.signups.reject");
  const id = useId();
  const modes = [
    ...(options.ban ? (["ban"] as const) : []),
    ...(options.erase ? (["delete"] as const) : []),
  ];
  const [mode, setMode] = useState<"ban" | "delete">(modes[0] ?? "ban");
  const [forever, setForever] = useState(false);
  const { ban } = options;
  return (
    <>
      <fieldset className="space-y-1">
        <legend className="mb-1 text-xs font-medium">{t("modeLabel")}</legend>
        {modes.map((value) => (
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
      {mode === "ban" && ban && (
        <fieldset className="space-y-1">
          <legend className="mb-1 text-xs font-medium">{t("banLength")}</legend>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <label className="flex min-h-10 items-center gap-2 text-sm">
              <input
                type="radio"
                name="duration"
                value="days"
                checked={!forever}
                onChange={() => setForever(false)}
                className="size-5"
              />
              <Input
                name="banDays"
                type="number"
                inputMode="numeric"
                min={1}
                max={ban.maxDays}
                defaultValue={Math.min(7, ban.maxDays)}
                disabled={forever}
                aria-label={t("banDays")}
                className="w-24"
              />
              {t("banDaysUnit")}
            </label>
            {ban.forever && (
              <label className="flex min-h-10 items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="duration"
                  value="forever"
                  checked={forever}
                  onChange={() => setForever(true)}
                  className="size-5"
                />
                {t("banForever")}
              </label>
            )}
          </div>
          <p className="text-xs text-pretty text-muted-foreground">
            {ban.forever
              ? t("banLengthHelpAny")
              : t("banLengthHelpMax", { count: ban.maxDays })}
          </p>
        </fieldset>
      )}
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
export function DecideControls({
  userIds,
  options,
}: {
  userIds: readonly number[];
  options: RejectOptions;
}) {
  const t = useTranslations("moderation.signups");
  const ids = userIds.join(",");
  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
      <ApproveForm ids={ids} />
      {(options.ban || options.erase) && (
        <ConfirmStep
          action={decideSignups}
          fields={{ decision: "reject", userIds: ids }}
          summary={t("reject.summary")}
          submit={t("reject.submit")}
          pendingLabel={t("reject.pending")}
          warning={t("reject.warning")}
          reason={t("reject.reason")}
        >
          <RejectChoice options={options} />
        </ConfirmStep>
      )}
    </div>
  );
}
