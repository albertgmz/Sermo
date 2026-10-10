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

/**
 * The current actor's permissions for a context, keyed by permission id (see
 * permissions.definitions): yes/no permissions as booleans, integers with -1 meaning unlimited.
 * Own-content, time-window and hierarchy conditions are not applied; clients use the map to hide
 * controls, and the server checks every action anyway.
 */
export const ResolvedPermissions = z
  .record(z.string(), z.union([z.boolean(), z.number().int()]))
  .meta({ id: "ResolvedPermissions" });

/**
 * The group whose title and badge a member displays: their highest-ranked group. Rank is display
 * and hierarchy only, never permissions.
 */
export const DisplayGroup = z
  .object({ id: Id, title: z.string(), userTitle: z.string(), badge: z.string() })
  .meta({ id: "DisplayGroup" });

/**
 * Fields every moderation action accepts: whether to notify the member it concerns, an optional
 * message to them, and the reason (actions that already require a reason keep their own).
 */
export const moderationNotice = {
  notify: z.boolean().default(true).describe("Notify the member this action concerns."),
  message: z.string().trim().max(1000).optional().describe("A message to that member."),
  reason: z.string().trim().max(1000).default(""),
};

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
