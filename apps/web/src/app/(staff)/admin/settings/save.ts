import "server-only";

import { SUPPORTED_LANGUAGES, settingsUpdate } from "@sermo/core/contracts";
import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { StaffFormState } from "@/components/staff/form-rows";
import { call } from "@/lib/sermo/client";
import { invalidArgument } from "@/lib/sermo/outcome";
import { text, whole } from "../groups/form-errors";
import { settingsFailure } from "./failure";
import { SHOWN } from "./shown";

// What a screen's form edits, key by key, and how each is read from the form.
//   int       a whole number (its range is the backend's)
//   bool      a switch
//   text      as typed
//   nullText  as typed, null when empty
//   language  one of the contract's languages
export type Kind = "int" | "bool" | "text" | "nullText" | "language";
export type Spec = Record<string, Kind>;

// `refused`: the request does not look like the form's own (see `shownKeys`) and nothing may be
// written from it.
export type Parsed = {
  body: Record<string, unknown>;
  fields: Record<string, string>;
  refused?: true;
};

// The settings a form says it showed: every row of a settings form carries a hidden field named
// `shown` with its key. A key that is not named is not read, so a request that leaves a field out
// (a hand-made one, a form from an older page) cannot turn it into "off", "0" or "empty".
export const shownKeys = (formData: FormData): Set<string> =>
  new Set(
    formData.getAll(SHOWN).filter((v): v is string => typeof v === "string"),
  );

// Reads the keys of `spec` that the form showed. A key is absent from the body when the form did
// not show it; a request that shows none of them, or that shows a key and posts no value for it
// (but a switch: an unticked box is not posted), is refused.
export async function scalars(spec: Spec, formData: FormData): Promise<Parsed> {
  const t = await getTranslations("adminSetup.errors");
  const body: Record<string, unknown> = {};
  const fields: Record<string, string> = {};
  const shown = shownKeys(formData);
  let refused = !Object.keys(spec).some((key) => shown.has(key));
  for (const [key, kind] of Object.entries(spec)) {
    if (!shown.has(key)) continue;
    if (kind !== "bool" && !formData.has(key)) refused = true;
    const raw = text(formData, key);
    if (kind === "int") {
      const value = whole(raw);
      if (value === null) fields[key] = t("number");
      else body[key] = value;
    } else if (kind === "bool") {
      body[key] = formData.get(key) !== null;
    } else if (kind === "text") {
      body[key] = raw;
    } else if (kind === "nullText") {
      body[key] = raw.trim() === "" ? null : raw.trim();
    } else if ((SUPPORTED_LANGUAGES as readonly string[]).includes(raw)) {
      body[key] = raw;
    } else {
      fields[key] = t("language");
    }
  }
  return refused ? { body: {}, fields: {}, refused: true } : { body, fields };
}

// Sends exactly the keys in `body` (the backend merges top-level keys and replaces nested ones,
// so a map or a list in it is always whole), then returns to the screen with a notice.
// `site` marks keys the public site's cached identity shows.
export async function saveSettings(
  parsed: Parsed,
  options: {
    back: string;
    known: (name: string) => boolean;
    site?: boolean;
    rename?: (path: (string | number)[]) => (string | number)[];
  },
): Promise<StaffFormState> {
  if (parsed.refused) return { error: await invalidArgument() };
  if (Object.keys(parsed.fields).length > 0) return { fields: parsed.fields };
  try {
    await call(settingsUpdate, parsed.body);
  } catch (error) {
    return settingsFailure(error, options.known, options.rename);
  }
  if (options.site) updateTag("site");
  redirect(`${options.back}?notice=saved`);
}
