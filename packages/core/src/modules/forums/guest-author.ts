import type { Ctx } from "../../context";
import { GUEST_ACCOUNT_ID } from "../../db/schema";
import { languageFor, phrase } from "../../i18n";
import type { UserSummaryRow } from "../../shared/users";
import { readSiteSettings } from "../settings";

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

/**
 * The word for a guest whose name is not kept (a member who deleted their account), in the site's
 * language: for the text the backend writes itself, where there is no client to choose the word.
 */
export function guestAuthorLabel(ctx: Ctx): string {
  return phrase(languageFor(null, readSiteSettings(ctx).defaultLanguage), "author.guest");
}

/** Control, format (zero-width, direction marks and overrides), surrogate, private and unassigned. */
const HIDDEN = /\p{C}/u;

/**
 * The name a guest gave as it is kept: in NFC, every run of white space one space, trimmed. Null
 * when it holds a control character (tabs and line breaks included), one nobody can see or one
 * that turns text around (so a guest cannot look like a member, and feeds stay valid XML), or is
 * not then 2 to 50 characters long.
 */
export function cleanGuestName(raw: string): string | null {
  const normal = raw.normalize("NFC");
  // Checked before spaces are collapsed: `\s` also takes some invisible characters (U+FEFF).
  if (HIDDEN.test(normal)) return null;
  const name = normal.replace(/\s+/gu, " ").trim();
  return name.length < 2 || name.length > 50 ? null : name;
}
