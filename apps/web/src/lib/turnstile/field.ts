// The form field the Turnstile widget puts its token in. The server actions of the guest forms
// read it with `tokenOf` and send it to the backend, which asks Cloudflare whether it is good.
export const TURNSTILE_FIELD = "turnstileToken";

// The token a form carried, or undefined when the widget was not on the form (Turnstile is off
// for it) or had not produced one yet.
export function tokenOf(formData: FormData): string | undefined {
  const value = formData.get(TURNSTILE_FIELD);
  return typeof value === "string" && value !== "" ? value : undefined;
}
