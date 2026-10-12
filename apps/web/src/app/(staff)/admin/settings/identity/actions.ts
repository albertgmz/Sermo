"use server";

import { getTranslations } from "next-intl/server";
import type { StaffFormState } from "@/components/staff/form-rows";
import { parseId } from "@/lib/sermo/ids";
import { text } from "../../groups/form-errors";
import { type Parsed, saveSettings } from "../save";
import { PICTURES } from "./pictures";

// Sends only the pictures the form changed: a file uploaded first (its id), or a removal (null).
// The other settings, and a picture left alone, are not in the request. Saving with nothing
// changed sends nothing.
export async function saveIdentity(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminSetup.identity");
  const parsed: Parsed = { body: {}, fields: {} };
  for (const { key } of PICTURES) {
    const typed = text(formData, key);
    if (typed !== "") {
      const id = parseId(typed);
      if (id === null) parsed.fields[key] = t("errors.file");
      else parsed.body[key] = id;
    } else if (text(formData, `${key}Remove`) === "1") {
      parsed.body[key] = null;
    }
  }
  if (
    Object.keys(parsed.fields).length === 0 &&
    Object.keys(parsed.body).length === 0
  ) {
    return { notice: t("nothingChanged") };
  }
  return saveSettings(parsed, {
    back: "/admin/settings/identity",
    known: (name) => PICTURES.some(({ key }) => key === name),
    site: true,
  });
}
