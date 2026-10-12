import "server-only";

import type { StaffFormState } from "@/components/staff/form-rows";
import { errorMessage } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";

// For actions: a refused call as the state of a form. A validation refusal that names a field of
// the form is shown under that field; anything else is the backend's message at the top.
export async function formFailure(
  error: unknown,
  known: readonly string[],
): Promise<StaffFormState> {
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
