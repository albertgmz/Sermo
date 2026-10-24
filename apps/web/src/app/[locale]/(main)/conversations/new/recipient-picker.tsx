"use client";

import { useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";
import { IdPicker } from "@/components/forum/id-picker";
import { findMemberChoices } from "@/components/forum/member-picker-field";
import { Label } from "@/components/ui/label";

type Recipient = { id: number; username: string };

// Recipients are found by the start of their username as the visitor types; the backend answers
// with at most 25 and decides who is in the list. Members in `exclude` are never offered. The
// picking is the shared `IdPicker`; this adds the chosen ids as fields of the form.
export function RecipientPicker({
  initial,
  exclude = [],
  onCount,
}: {
  initial?: Recipient;
  exclude?: number[];
  // Told how many are chosen, as it changes.
  onCount?: (count: number) => void;
}) {
  const t = useTranslations("conversations.recipientPicker");
  const inputId = useId();
  const [ids, setIds] = useState<number[]>(initial ? [initial.id] : []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: only a change of the count is told
  useEffect(() => onCount?.(ids.length), [ids.length]);

  return (
    <fieldset aria-labelledby={`${inputId}-label`} className="space-y-2">
      <Label id={`${inputId}-label`} htmlFor={inputId}>
        {t("label")}
      </Label>
      {ids.map((id) => (
        <input key={id} type="hidden" name="recipientIds" value={id} />
      ))}
      <IdPicker
        ids={ids}
        known={initial ? [{ id: initial.id, label: initial.username }] : []}
        search={findMemberChoices}
        inputId={inputId}
        exclude={exclude}
        text={{
          chosen: t("aria.chosen"),
          placeholder: t("placeholder"),
          noMatch: t("noMatch"),
          remove: (name) => t("aria.remove", { name }),
        }}
        onChange={setIds}
      />
    </fieldset>
  );
}
