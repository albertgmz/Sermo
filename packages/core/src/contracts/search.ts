import * as z from "zod";
import { defineContract } from "../operation";
import { Id, Page, Timestamp, UserSummary } from "./common";
import { ThreadPrefixTag } from "./forums";

export const SearchResult = z
  .object({
    post: z.object({
      id: Id,
      position: z.number().int().nonnegative(),
      createdAt: Timestamp,
      author: UserSummary,
      /** Plain-text excerpt of the post source (at most ~200 characters). */
      excerpt: z.string(),
    }),
    thread: z.object({
      id: Id,
      title: z.string(),
      nodeId: Id,
      node: z.object({ id: Id, title: z.string() }),
      prefix: ThreadPrefixTag.nullable(),
    }),
  })
  .meta({ id: "SearchResult" });

/**
 * The most results a search's numbered pages hold, as XenForo's maximumSearchResults: the newest
 * results the viewer may see, found within one request's examination budget.
 */
export const SEARCH_PAGES_MAX = 500;

export const searchQuery = defineContract({
  name: "search.query",
  summary:
    "Full-text search over thread titles and post bodies the viewer can see, newest first. " +
    "Every word must appear as a whole word (case- and accent-insensitive). A page may hold " +
    "fewer than `limit` results while `nextCursor` is non-null; keep paging to continue. " +
    "`page` (from 1; a `cursor` takes precedence over it) is the page of `limit` results at " +
    "that place in the list; with it, `total` is how many results the numbered pages hold " +
    "(`ceil(total / limit)` pages), null without it. As on XenForo, they hold at most the " +
    `newest ${SEARCH_PAGES_MAX} results the viewer may see, and fewer where one request ` +
    "examined as many matches as it may before finding that many; a cursor walks on past both.",
  kind: "read",
  input: z.object({
    q: z.string().trim().min(1).max(200),
    titlesOnly: z.boolean().default(false),
    nodeId: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Only search this node and its descendants."),
    authorId: Id.optional().describe("Only posts written by this member."),
    prefixId: Id.optional().describe("Only posts in threads carrying this prefix."),
    page: z.number().int().min(1).optional(),
    cursor: z.string().min(1).max(512).optional(),
    limit: z.number().int().min(1).max(50).default(20),
  }),
  output: Page(SearchResult).extend({ total: z.number().int().nonnegative().nullable() }),
});
