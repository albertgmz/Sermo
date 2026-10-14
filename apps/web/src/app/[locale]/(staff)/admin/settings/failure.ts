import "server-only";

import type { StaffFormState } from "@/components/staff/form-rows";
import { errorMessage } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";

// For actions: a refused call as the state of a form. A validation issue is shown under the
// control that `known` names for its path (the longest prefix of the path that it accepts, joined
// with dots: `socialLinks.x`), anything else is the backend's message at the top of the form.
// `rename` maps a path onto the form's own (the backend counts the rows it was sent).
export async function settingsFailure(
  error: unknown,
  known: (name: string) => boolean,
  rename: (path: (string | number)[]) => (string | number)[] = (path) => path,
): Promise<StaffFormState> {
  if (
    error instanceof SermoError &&
    error.code === "validation" &&
    error.issues?.length
  ) {
    const fields: Record<string, string> = {};
    const rest: string[] = [];
    for (const issue of error.issues) {
      const path = rename(
        Array.isArray(issue.path)
          ? issue.path.filter(
              (part): part is string | number =>
                typeof part === "string" || typeof part === "number",
            )
          : [],
      );
      const message = issue.message || error.message;
      let name: string | undefined;
      for (let length = path.length; length > 0 && !name; length--) {
        const candidate = path.slice(0, length).join(".");
        if (known(candidate)) name = candidate;
      }
      if (name && !(name in fields)) fields[name] = message;
      else rest.push(message);
    }
    if (Object.keys(fields).length > 0) {
      return { error: rest.join(" ") || undefined, fields };
    }
  }
  return { error: await errorMessage(error) };
}
