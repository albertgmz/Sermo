import * as z from "zod";
import { CONTENT_STATES, REACTION_CONTENT_TYPES } from "../db/schema";
import { MAX_BODY_LENGTH } from "../render";

export const Id = z.number().int().positive();
export const Timestamp = z.iso.datetime().describe("ISO 8601 UTC timestamp");
export const ContentState = z.enum(CONTENT_STATES);
export const ReactionContentType = z.enum(REACTION_CONTENT_TYPES);

/** Markdown source for posts, messages, profile posts and comments. */
export const Body = z
  .string()
  .trim()
  .min(1)
  .max(MAX_BODY_LENGTH)
  .describe("Markdown (CommonMark + GitHub extensions). Raw HTML is shown literally.");

export const Title = z.string().trim().min(1).max(150);

export const UserSummary = z.object({ id: Id, username: z.string() }).meta({ id: "UserSummary" });

export const ReactionSummary = z
  .object({
    /** Count per reaction type id (as a string key). Types with zero reactions are omitted. */
    counts: z.record(z.string(), z.number().int().positive()),
    total: z.number().int().nonnegative(),
    /** The viewer's reaction type id on this item, or null (always null for guests). */
    mine: Id.nullable(),
  })
  .meta({ id: "ReactionSummary" });

export const Ok = z.object({ ok: z.literal(true) });
export const Empty = z.object({});

// Pagination ---------------------------------------------------------------

export const Cursor = z.string().min(1).max(512).describe("Opaque cursor from a previous page.");
export const Limit = z.number().int().min(1).max(100).default(20);
export const pageInput = { cursor: Cursor.optional(), limit: Limit };

/** The one pagination envelope. `nextCursor` is null on the last page. */
export function Page<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}
