import * as z from "zod";
import { BOOKMARK_CONTENT_TYPES } from "../db/schema";
import { defineContract } from "../operation";
import { Id, Ok, Page, pageInput, Timestamp, UserSummary } from "./common";

export const BookmarkContentType = z.enum(BOOKMARK_CONTENT_TYPES);

/**
 * One bookmark as listed: what it points to, drawn from the item as the viewer can see it now.
 * `postPosition` is set for posts so a client can link to the post's page.
 */
export const Bookmark = z
  .object({
    id: Id,
    contentType: BookmarkContentType,
    contentId: Id,
    createdAt: Timestamp,
    /** Thread title (threads and posts) or conversation title. */
    title: z.string(),
    /** The thread of a post or a thread; null for conversations. */
    threadId: Id.nullable(),
    postPosition: z.number().int().nonnegative().nullable(),
    /** Author of the post, thread starter, or conversation starter. */
    author: UserSummary,
    /** Plain-text start of the post or first post (spoilers left out); empty for conversations. */
    excerpt: z.string(),
  })
  .meta({ id: "Bookmark" });

export const bookmarksList = defineContract({
  name: "bookmarks.list",
  summary:
    "The viewer's bookmarks, newest first. Items the viewer can no longer see are left out, so " +
    "a page may be short while `nextCursor` is set. Signed-in members.",
  kind: "read",
  input: z.object({ ...pageInput }),
  output: Page(Bookmark),
});

export const bookmarksStatus = defineContract({
  name: "bookmarks.status",
  summary:
    "Which of up to 100 items of one type the viewer has bookmarked. Guests get an empty list.",
  kind: "read",
  input: z.object({ contentType: BookmarkContentType, ids: z.array(Id).max(100) }),
  output: z.object({ bookmarked: z.array(Id) }),
});

export const bookmarksSet = defineContract({
  name: "bookmarks.set",
  summary:
    "Bookmark an item the viewer can see (`bookmarked: true`) or remove the bookmark. " +
    "Repeating either is harmless. An item the viewer cannot see is not found. Adding needs " +
    "`bookmark.create`; removing needs nothing.",
  kind: "write",
  input: z.object({ contentType: BookmarkContentType, contentId: Id, bookmarked: z.boolean() }),
  output: Ok,
});
