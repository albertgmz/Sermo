import "server-only";

import { authVerifyPassword } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import type { StaffFormState } from "@/components/staff/form-rows";
import { call, errorMessage } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";

// The refusal of a wrong `actorPassword`: the backend answers forbidden with its own message
// (there is no code of its own for it), or rate_limited once too many wrong ones were given.
// Whatever else makes a write forbidden is told apart by the message.
function refusesPassword(error: SermoError) {
  return (
    error.code === "rate_limited" ||
    (error.code === "forbidden" && /not your password/i.test(error.message))
  );
}

// For actions: the state of a form whose password field is empty, or null. The password is sent
// with the write itself, which checks it first.
export async function missingPassword(
  formData: FormData,
): Promise<StaffFormState> {
  if (text(formData, "actorPassword") !== "") return null;
  const t = await getTranslations("adminGroups.errors");
  return { fields: { actorPassword: t("password") } };
}

// For actions whose backend operation takes no password: the state of a form whose password is
// missing or wrong, or null when it is the administrator's own. The operation itself does not ask,
// so the check is a call of its own (`auth.verifyPassword`) made before the write; two calls,
// because there is no password to send with the write. A wrong password writes nothing.
export async function unconfirmedPassword(
  formData: FormData,
): Promise<StaffFormState> {
  const absent = await missingPassword(formData);
  if (absent) return absent;
  try {
    await call(authVerifyPassword, {
      password: text(formData, "actorPassword"),
    });
    return null;
  } catch (error) {
    return formFailure(error, ["actorPassword"]);
  }
}

// For actions: a refused call as the state of a form. A validation refusal that names a field of
// the form is shown under that field; anything else is the backend's message at the top. A form
// that lists `actorPassword` among `known` also shows a refused password under its field.
export async function formFailure(
  error: unknown,
  known: readonly string[],
): Promise<StaffFormState> {
  if (
    error instanceof SermoError &&
    known.includes("actorPassword") &&
    refusesPassword(error)
  ) {
    return { fields: { actorPassword: error.message } };
  }
  if (
    error instanceof SermoError &&
    error.code === "validation" &&
    error.issues?.length
  ) {
    const fields: Record<string, string> = {};
    const rest: string[] = [];
    for (const issue of error.issues) {
      const name = Array.isArray(issue.path) ? String(issue.path[0]) : "";
      const message = issue.message || error.message;
      if (known.includes(name) && !(name in fields)) fields[name] = message;
      else rest.push(message);
    }
    if (Object.keys(fields).length > 0) {
      return { error: rest.join(" ") || undefined, fields };
    }
  }
  return { error: await errorMessage(error) };
}

// The `value` of a form field as text, or "" when it is absent or a file.
export const text = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

// A whole number typed in a field, or null.
export const whole = (raw: string) =>
  /^-?\d{1,15}$/.test(raw.trim()) ? Number(raw.trim()) : null;
