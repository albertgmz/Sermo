"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { IdPicker } from "@/components/forum/id-picker";

// ForumPicker: chooses forums by name for an administration form. The forums are the ones the
// page lists (the choice is short enough to hold), drawn by the shared `IdPicker`. The chosen ids
// go with the form as one field, `name`, a comma-separated list that is empty when none is
// chosen, so the field is always there for the action to read.
//
// Props
//   name     The field the ids are sent in. Default "forumIds".
//   choices  Every forum that can be chosen, with the label to show (the page puts the depth in it).
//   chosen   The ids chosen to start with.
export function ForumPicker({
  name = "forumIds",
  choices,
  chosen,
}: {
  name?: string;
  choices: { id: number; label: string }[];
  chosen: number[];
}) {
  const t = useTranslations("admin.forumPicker");
  const [ids, setIds] = useState(chosen);
  return (
    <>
      <input type="hidden" name={name} value={ids.join(",")} />
      <IdPicker
        ids={ids}
        known={choices}
        options={choices}
        text={{
          chosen: t("chosen"),
          search: t("search"),
          placeholder: t("placeholder"),
          noMatch: t("noMatch"),
          remove: (forum) => t("remove", { name: forum }),
        }}
        onChange={setIds}
      />
    </>
  );
}
