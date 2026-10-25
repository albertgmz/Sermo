"use server";

import {
  profilesAcceptAdult,
  profilesSetBirthDate,
} from "@sermo/core/contracts";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { call } from "@/lib/sermo/client";
import { attempt } from "@/lib/sermo/outcome";
import { pageOfRequest } from "@/lib/sermo/request-page";

// What the +18 warning shows after a confirmation: the content may load (`done`), the member is
// under 18 (`minor`), or the backend's refusal.
export type AdultConfirmState = { done?: true; minor?: true; error?: string };

// A full date as a date field sends it (`YYYY-MM-DD`); null for anything else. Whether the day
// exists, and is not in the future, is the backend's to say. (Not exported: a "use server" file
// exports its actions only.)
function birthDateOf(
  value: FormDataEntryValue | null,
): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ""));
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number) as [
    number,
    number,
    number,
  ];
  return { year, month, day };
}

// The member confirms the +18 warning. A form with a `birthDate` field first stores the date (the
// member had none); a minor's date stops there. Once the confirmation is recorded every page is
// read again, since the member now sees +18 content in lists and feeds too, and the warning loads
// the content it stood in for.
export async function confirmAdult(
  _previous: AdultConfirmState,
  formData: FormData,
): Promise<AdultConfirmState> {
  const page = await pageOfRequest();
  if (formData.has("birthDate")) {
    const date = birthDateOf(formData.get("birthDate"));
    if (!date) {
      return {
        error: (await getTranslations("forum.adultGate"))("dateMissing"),
      };
    }
    const stored = await attempt(page, () => call(profilesSetBirthDate, date));
    if (!stored.ok) return { error: stored.error };
    if (stored.value.refusal === "minor") return { minor: true };
  }
  const accepted = await attempt(page, () => call(profilesAcceptAdult, {}));
  if (!accepted.ok) return { error: accepted.error };
  revalidatePath("/[locale]", "layout");
  return { done: true };
}
