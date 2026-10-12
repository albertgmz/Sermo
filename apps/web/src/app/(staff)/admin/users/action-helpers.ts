import "server-only";

import { authVerifyPassword } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import type { StaffFormState } from "@/components/staff/form-rows";
import { call, errorMessage } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { text } from "../groups/form-errors";

// The member a form is about, from its hidden `id` field; null when it is not a record id.
export const memberOf = (formData: FormData) => parseId(text(formData, "id"));

// The acting administrator's own password, checked on its own (`auth.verifyPassword`) so a wrong
// one shows on the password field and changes nothing. The backend checks it again with the
// change; the two calls are not atomic. Returns the state to show, or null when the password is
// right.
export async function passwordRefusal(
  formData: FormData,
): Promise<StaffFormState> {
  const password = text(formData, "actorPassword");
  if (password === "") {
    const t = await getTranslations("adminUsers.errors");
    return { fields: { actorPassword: t("password") } };
  }
  try {
    await call(authVerifyPassword, { password });
  } catch (error) {
    return { fields: { actorPassword: await errorMessage(error) } };
  }
  return null;
}

// A checkbox of a form.
export const ticked = (formData: FormData, name: string) =>
  formData.get(name) !== null;
