import "server-only";

import type { TurnstileForm } from "@sermo/core/contracts";
import { getSite } from "./site";

// The public site key of the Turnstile widget for a guest form, or null when the site does not
// guard that form (Turnstile off, not set up, or the form not in its list). Only the key: the
// secret never leaves the backend.
export async function turnstileKeyFor(
  form: TurnstileForm,
): Promise<string | null> {
  const { turnstile } = await getSite();
  return turnstile?.forms.includes(form) ? turnstile.siteKey : null;
}
