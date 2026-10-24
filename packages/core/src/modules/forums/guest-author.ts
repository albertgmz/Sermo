import { GUEST_ACCOUNT_ID } from "../../db/schema";
import type { UserSummaryRow } from "../../shared/users";

/** A thread's or post's author as the contracts give it (`ContentAuthor`). */
export type ContentAuthorValue =
  | { kind: "member"; id: number; username: string }
  | { kind: "guest"; name: string | null };

/** Whether content belongs to the reserved guest account: there is then no member to show. */
export const isGuestAuthor = (userId: number): boolean => userId === GUEST_ACCOUNT_ID;

/**
 * The author of a thread or post: the member, from the page's batch of summaries, or for guest
 * content the name the guest gave and nothing of the reserved account behind it.
 */
export function contentAuthor(
  users: (id: number) => UserSummaryRow,
  userId: number,
  guestName: string | null | undefined,
): ContentAuthorValue {
  if (isGuestAuthor(userId)) return { kind: "guest", name: guestName ?? null };
  const { id, username } = users(userId);
  return { kind: "member", id, username };
}
