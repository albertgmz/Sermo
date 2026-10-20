"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { text } from "@/app/[locale]/(staff)/admin/groups/form-errors";
import type { StaffFormState } from "@/components/staff/form-rows";
import { createApiKey, deleteApiKey } from "@/lib/sermo/auth";

const PAGE = "/account/api";

// Better Auth's answers for a request without a live session: its own, and the API key plugin's.
const signedOut = (code: string | undefined) =>
  code === "UNAUTHORIZED" || code === "UNAUTHORIZED_SESSION";

// A form state of the key forms. `key` is the new key itself: it reaches the page this once, in
// the answer to the action, and never goes into an address, a cookie or a cache.
export type KeyFormState =
  | (NonNullable<StaffFormState> & { key?: string })
  | null;

// Better Auth's error code to the key under account.apiKeys.errors.
const ERRORS: Record<string, string> = {
  PASSWORD_REQUIRED: "required",
  INVALID_PASSWORD: "wrongPassword",
  API_KEY_EXISTS: "exists",
  TOO_MANY_ATTEMPTS: "rateLimited",
  RATE_LIMITED: "rateLimited",
};

// Makes the member's key, or with `replace=1` a new one in place of the ones they have. The
// password field is the confirmation step's (`actorPassword`); a refusal of it is shown there.
export async function issueKey(
  _previous: KeyFormState,
  formData: FormData,
): Promise<KeyFormState> {
  const t = await getTranslations("account.apiKeys.errors");
  const password = text(formData, "actorPassword");
  if (!password) return { fields: { actorPassword: t("required") } };
  const result = await createApiKey(
    password,
    text(formData, "replace") === "1",
  );
  if (result.ok && result.key) {
    // The answer carries the page read again, so the rows behind the key (and the page kept for
    // Back) already list it.
    refresh();
    return { key: result.key };
  }
  if (signedOut(result.code)) redirect("/login");
  // A key made meanwhile (another tab, a script): the page is read again, so it lists the key and
  // offers to replace it, where this message then shows.
  if (result.code === "API_KEY_EXISTS") refresh();
  const message = t(
    ((result.code && ERRORS[result.code]) || "generic") as "generic",
  );
  return result.code === "INVALID_PASSWORD" ||
    result.code === "PASSWORD_REQUIRED"
    ? { fields: { actorPassword: message } }
    : { error: message };
}

// The backend revokes only a key of the member's own (another one is not found). A key already
// gone is the outcome asked for.
export async function revokeKey(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const result = await deleteApiKey(text(formData, "key"));
  if (signedOut(result.code)) redirect("/login");
  // The notice sits under the page's heading, so the page opens at the top.
  if (result.ok) redirect(`${PAGE}?notice=revoked`);
  if (result.code === "KEY_NOT_FOUND") redirect(PAGE);
  const t = await getTranslations("account.apiKeys.errors");
  return { error: t("generic") };
}
