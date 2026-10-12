import "server-only";

import { parseId } from "@/lib/sermo/ids";
import { text } from "../groups/form-errors";

// The member a form is about, from its hidden `id` field; null when it is not a record id.
export const memberOf = (formData: FormData) => parseId(text(formData, "id"));

// A checkbox of a form.
export const ticked = (formData: FormData, name: string) =>
  formData.get(name) !== null;
