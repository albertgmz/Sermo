import type { ContentAuthor } from "@sermo/core/contracts";
import type * as z from "zod";

/** The author of a thread or post: a member, or a guest, who has no account. */
export type ContentAuthorRef = z.output<typeof ContentAuthor>;
/** Whoever a page draws next to content: a member summary, or a thread's or post's author. */
export type AuthorRef = ContentAuthorRef | { id: number; username: string };

/**
 * A page's lookup of the members it shows: by member id, or by an author, where a guest is drawn
 * by the name they gave and nothing of an account.
 */
export type Lookup<T> = (ref: number | AuthorRef) => T;

/** The member id of an author, or null for a guest. */
export const memberIdOf = (author: AuthorRef): number | null =>
  "kind" in author && author.kind === "guest" ? null : author.id;

/** The member summary of an author, or null for a guest. */
export const memberOf = (
  author: AuthorRef,
): { id: number; username: string } | null =>
  "kind" in author && author.kind === "guest"
    ? null
    : { id: author.id, username: author.username };

/** Whether an author is the member `id` (never a guest, nor when `id` is null). */
export const sameMember = (author: AuthorRef, id: number | null): boolean =>
  id !== null && memberIdOf(author) === id;

/** The name an author is shown under: the member's username, or the name a guest gave. */
export const authorName = (author: AuthorRef): string =>
  "kind" in author && author.kind === "guest"
    ? (author.name ?? "")
    : author.username;
