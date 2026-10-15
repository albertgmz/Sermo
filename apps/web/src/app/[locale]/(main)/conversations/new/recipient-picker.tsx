"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { findRecipients } from "@/app/[locale]/(main)/conversations/actions";
import { type Choice, IdPicker } from "@/components/forum/id-picker";

type Recipient = { id: number; username: string };

async function findMembers(prefix: string): Promise<Choice[]> {
  return (await findRecipients(prefix)).map((user) => ({
    id: user.id,
    label: user.username,
  }));
}

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
  const [ids, setIds] = useState<number[]>(initial ? [initial.id] : []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: only a change of the count is told
  useEffect(() => onCount?.(ids.length), [ids.length]);

  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-sm font-medium">{t("label")}</legend>
      {ids.map((id) => (
        <input key={id} type="hidden" name="recipientIds" value={id} />
      ))}
      <IdPicker
        ids={ids}
        known={initial ? [{ id: initial.id, label: initial.username }] : []}
        search={findMembers}
        exclude={exclude}
        text={{
          chosen: t("aria.chosen"),
          search: t("aria.search"),
          placeholder: t("placeholder"),
          noMatch: t("noMatch"),
          remove: (name) => t("aria.remove", { name }),
        }}
        onChange={setIds}
      />
    </fieldset>
  );
}
