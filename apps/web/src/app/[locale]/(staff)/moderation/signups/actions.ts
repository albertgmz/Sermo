"use server";

import { MAX_SIGNUP_DECISIONS, signupsDecide } from "@sermo/core/contracts";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import type { StaffFormState } from "@/components/staff/form-rows";
import { call } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { formFailure, text } from "../../admin/groups/form-errors";
import { resultQuery } from "./result";

// The ids of a form's `userIds` field: record ids separated by commas, each once.
function idsOf(raw: string): number[] | null {
  if (raw.trim() === "") return [];
  const ids = raw.split(",").map((word) => parseId(word.trim()));
  if (ids.some((id) => id === null)) return null;
  return [...new Set(ids as number[])];
}

// Approves or rejects the sign-ups named in `userIds`. Rejecting erases the account by default,
// which asks for the staff member's own password, or bans it for good. The backend judges every
// account on its own and answers for each; the page is shown the counts and the reasons of the
// ones it did not change.
export async function decideSignups(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("moderation.errors");
  const userIds = idsOf(text(formData, "userIds"));
  if (userIds === null) return { error: t("id") };
  if (userIds.length === 0) return { error: t("signupsNone") };
  if (userIds.length > MAX_SIGNUP_DECISIONS) {
    return { error: t("signupsTooMany", { count: MAX_SIGNUP_DECISIONS }) };
  }
  const decision = text(formData, "decision");
  if (decision !== "approve" && decision !== "reject") {
    return { error: t("decision") };
  }
  const input: z.input<typeof signupsDecide.input> = { userIds, decision };
  if (decision === "reject") {
    input.reason = text(formData, "reason").trim();
    const mode = text(formData, "mode");
    if (mode !== "delete" && mode !== "ban") return { error: t("signupsMode") };
    input.mode = mode;
    if (mode === "delete") {
      input.actorPassword = text(formData, "actorPassword");
      if (input.actorPassword === "") return { error: t("signupsPassword") };
    }
  }
  let answer: z.output<typeof signupsDecide.output>;
  try {
    answer = await call(signupsDecide, input);
  } catch (error) {
    return formFailure(error, []);
  }
  redirect(`/moderation/signups?${resultQuery(decision, answer)}`);
}
