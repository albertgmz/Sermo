"use server";

import type { StaffFormState } from "@/components/staff/form-rows";
import { type Spec, saveSettings, scalars } from "../settings/save";

const EMAIL: Spec = {
  emailHourlyCap: "int",
  conversationEmailIncludesBody: "bool",
  digestInactiveDays: "int",
};

export async function saveEmail(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  return saveSettings(await scalars(EMAIL, formData), {
    back: "/admin/email",
    known: (name) => name in EMAIL,
  });
}
