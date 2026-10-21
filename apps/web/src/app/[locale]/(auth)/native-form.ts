// A form of the sign-in pages can be sent before React has taken the page over (a quick press, a
// slow phone, a script that did not load). The browser then posts the form itself, and the server
// action's answer is not a page it can draw: the form shows no state, and a returned state is
// drawn by nothing. So the actions tell the two apart and answer a form that was not sent by the
// hydrated page with a redirect to a page that says what happened.

// The hidden field `HydrationMark` fills in: empty in the page the server draws, "1" once React
// has hydrated it, so only a submit that React handled carries it.
export const HYDRATED_FIELD = "hydrated";

// The address parameter that carries a refusal back to the form's page.
export const REFUSED_PARAM = "refused";

// The messages a refusal can name: the keys under `auth.actions.errors`.
export const REFUSALS = [
  "invalidCredentials",
  "emailNotVerified",
  "usernameTaken",
  "emailTaken",
  "invalidUsername",
  "invalidEmail",
  "passwordRequired",
  "passwordTooShort",
  "passwordTooLong",
  "banned",
  "rateLimited",
  "termsRequired",
  "generic",
  "passwordMismatch",
  "mailOff",
  "invalidToken",
  "turnstileRequired",
  "turnstileFailed",
  "turnstileUnavailable",
  "registrationClosed",
  "underAge",
  "fieldRequired",
  "invalidField",
] as const;

export type Refusal = (typeof REFUSALS)[number];

export const isHydrated = (data: FormData) => data.get(HYDRATED_FIELD) === "1";

// The refusal an address names; anything else the address says is no refusal.
export function refusalIn(
  value: string | string[] | undefined,
): Refusal | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return REFUSALS.find((key) => key === first);
}

// The page a refused form goes back to: `path` with the refusal and the parameters the page needs
// to draw the same form again.
export function refusedAddress(
  path: string,
  key: Refusal,
  params: Record<string, string> = {},
) {
  const query = new URLSearchParams({ ...params, [REFUSED_PARAM]: key });
  return `${path}?${query}`;
}
