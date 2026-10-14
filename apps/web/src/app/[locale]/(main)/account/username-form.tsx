"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import type { FormState } from "@/app/[locale]/(main)/account/action-form";
import { renameMember } from "@/app/[locale]/(main)/account/actions";
import { PendingButton } from "@/components/forum/pending-button";
import { SettingsRow } from "@/components/forum/settings";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// `units` is the changes left, null where renaming is free. The one setting that does not save on
// its own: a change is limited and public, so it waits for a button and a confirmation.
export function UsernameForm({
  username,
  units,
}: {
  username: string;
  units: number | null;
}) {
  const t = useTranslations("account.username");
  const [state, action] = useActionState<FormState, FormData>(
    renameMember,
    null,
  );
  const [value, setValue] = useState(username);
  const next = value.trim();
  const changed = next !== username && next !== "";
  return (
    <form action={action}>
      <SettingsRow
        id="username"
        title={t("label")}
        htmlFor="account-username"
        description={units === null ? t("free") : t("units", { count: units })}
        status={
          state && (
            <output className="max-w-full text-xs font-medium text-destructive [overflow-wrap:anywhere]">
              {state.error}
            </output>
          )
        }
      >
        <Input
          id="account-username"
          name="username"
          autoComplete="username"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        {changed && (
          <div className="space-y-3">
            <p className="text-xs text-pretty text-muted-foreground">
              {t("limited")}
            </p>
            <div className="flex min-h-10 items-start gap-3 py-2">
              <Checkbox id="username-confirm" name="confirm" />
              <Label
                htmlFor="username-confirm"
                className="block leading-normal font-normal text-muted-foreground [overflow-wrap:anywhere]"
              >
                {t("confirmation", { username: next })}
              </Label>
            </div>
            <PendingButton className="min-h-10 px-4">
              {t("submit")}
            </PendingButton>
          </div>
        )}
      </SettingsRow>
    </form>
  );
}
