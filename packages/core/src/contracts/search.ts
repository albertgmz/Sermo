import * as z from "zod";
import { defineContract } from "../operation";
import { Id, Page, Timestamp, UserSummary } from "./common";

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
    thread: z.object({ id: Id, title: z.string(), nodeId: Id }),
  })
  .meta({ id: "SearchResult" });

export const searchQuery = defineContract({
  name: "search.query",
  summary:
    "Full-text search over thread titles and post bodies the viewer can see, newest first. " +
    "Every word must appear as a whole word (case- and accent-insensitive). A page may hold " +
    "fewer than `limit` results while `nextCursor` is non-null; keep paging to continue.",
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
    cursor: z.string().min(1).max(512).optional(),
    limit: z.number().int().min(1).max(50).default(20),
  }),
  output: Page(SearchResult),
});
