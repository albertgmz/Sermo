// Where a refused One Tap sign-in goes: the sign-in page, which names the refusal with the words of
// a provider sign-in (`(auth)/social-refusal.ts`). The backend answers its own refusals with a
// code; an address that exists but is not linked comes as a 401 without one.
export function oneTapRefusalAddress(status: number, body: unknown): string {
  const code = (body as { code?: unknown } | null)?.code;
  const error =
    typeof code === "string" && /^\w+$/.test(code)
      ? code
      : status === 401
        ? "account_not_linked"
        : status === 429
          ? "RATE_LIMITED"
          : "one_tap_failed";
  return `/login?${new URLSearchParams({ via: "google", error })}`;
}
