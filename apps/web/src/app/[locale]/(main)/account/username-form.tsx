"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { ActionForm } from "@/app/[locale]/(main)/account/action-form";
import { renameMember } from "@/app/[locale]/(main)/account/actions";
import { Help, Row } from "@/components/staff/rows";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// `units` is the changes left, null where renaming is free.
export function UsernameForm({
  username,
  units,
}: {
  username: string;
  units: number | null;
}) {
  const t = useTranslations("account.username");
  const [value, setValue] = useState(username);
  const next = value.trim();
  return (
    <ActionForm action={renameMember} submit={t("submit")}>
      <Row label={t("label")} htmlFor="account-username">
        <Input
          id="account-username"
          name="username"
          autoComplete="username"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-describedby="username-help"
        />
        <Help id="username-help">
          {units === null ? t("free") : t("units", { count: units })}
        </Help>
        {next !== username && next !== "" && (
          <div className="flex min-h-10 items-start gap-3 py-2">
            <Checkbox id="username-confirm" name="confirm" />
            <Label
              htmlFor="username-confirm"
              className="block leading-normal font-normal text-muted-foreground [overflow-wrap:anywhere]"
            >
              {t("confirmation", { username: next })}
            </Label>
          </div>
        )}
      </Row>
    </ActionForm>
  );
}
