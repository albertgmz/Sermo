"use server";

import { usersAdminRevokeSessions } from "@sermo/core/contracts";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { StaffFormState } from "@/components/staff/form-rows";
import { call } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { formFailure, text } from "../../../groups/form-errors";
import { memberOf } from "../../action-helpers";

// Signs a member out: one session when the form carries `sessionId`, all of them otherwise. The
// backend refuses an erased member and, for a member holding an administration permission,
// an actor without admin.permissions; its message is shown as it is.
export async function revokeSessions(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminUsers.errors");
  const userId = memberOf(formData);
  const raw = text(formData, "sessionId");
  const sessionId = raw === "" ? undefined : parseId(raw);
  if (userId === null || sessionId === null) return { error: t("id") };
  try {
    await call(usersAdminRevokeSessions, {
      userId,
      ...(sessionId === undefined ? {} : { sessionId }),
      reason: text(formData, "reason"),
    });
  } catch (error) {
    return formFailure(error, []);
  }
  redirect(
    `/admin/users/${userId}/sessions?notice=${sessionId === undefined ? "allRevoked" : "revoked"}`,
  );
}
