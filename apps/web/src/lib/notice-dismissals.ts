import { parseId } from "@/lib/sermo/ids";

// The notices a guest dismissed, kept in a cookie because a guest has no account to keep them in:
// the ids joined by dots, the most recent last. A member's dismissals are kept by the backend.
export const NOTICES_DISMISSED_COOKIE = "forum_notices_dismissed";

// The most ids the cookie keeps; the oldest drop first.
const KEPT = 50;

export function parseDismissed(value: string | undefined): number[] {
  return (value ?? "")
    .split(".")
    .map(parseId)
    .filter((id): id is number => id !== null);
}

// The cookie value once `id` is dismissed.
export function withDismissed(value: string | undefined, id: number): string {
  const ids = parseDismissed(value).filter((kept) => kept !== id);
  return [...ids, id].slice(-KEPT).join(".");
}
