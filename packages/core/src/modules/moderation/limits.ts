import type { Actor } from "../../actor";
import { actorUserId } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { RateLimitedError } from "../../errors";
import { markPublic } from "../../operation";
import { can, type IntegerPermissionId, permissionValue } from "../../permissions";
import { readSiteSettings } from "../settings";

/**
 * Limits on how fast a member writes, checked inside the write's own transaction so two requests
 * cannot both pass. Each check is one indexed lookup: the newest row of the member in each table
 * that holds what they write (the flood clock), or a count of the member's rows in the last 24
 * hours that stops at the limit.
 */
export type WriteKind = "thread" | "reply" | "wall_post" | "comment" | "message" | "conversation";

const DAY = 86_400_000;

/** Every table a member writes to shares the flood clock: the newest id is the newest row. */
export const floodClockSql = [
  "SELECT created_at FROM posts WHERE user_id = ?1 ORDER BY id DESC LIMIT 1",
  "SELECT created_at FROM profile_posts WHERE user_id = ?1 ORDER BY id DESC LIMIT 1",
  "SELECT created_at FROM profile_post_comments WHERE user_id = ?1 ORDER BY id DESC LIMIT 1",
  "SELECT created_at FROM conversation_messages WHERE user_id = ?1 ORDER BY id DESC LIMIT 1",
] as const;

/** What a daily limit counts, and the statement that counts it up to the limit (a test checks its plan). */
export const dailyLimits = {
  "antispam.postsPerDay": {
    noun: "posts",
    sql: "SELECT count(*) AS n FROM (SELECT 1 FROM posts WHERE user_id = ?1 AND created_at >= ?2 LIMIT ?3)",
  },
  "antispam.threadsPerDay": {
    noun: "threads",
    sql: "SELECT count(*) AS n FROM (SELECT 1 FROM threads WHERE user_id = ?1 AND created_at >= ?2 LIMIT ?3)",
  },
  "antispam.conversationsPerDay": {
    noun: "conversations",
    sql: "SELECT count(*) AS n FROM (SELECT 1 FROM conversations WHERE user_id = ?1 AND created_at >= ?2 LIMIT ?3)",
  },
  "antispam.negativeReactionsPerDay": {
    noun: "negative reactions",
    sql: "SELECT count(*) AS n FROM (SELECT 1 FROM reactions WHERE user_id = ?1 AND score < 0 AND created_at >= ?2 LIMIT ?3)",
  },
} as const satisfies Record<string, { noun: string; sql: string }>;

export type DailyLimit = keyof typeof dailyLimits;

/** The member has reached `permission`'s limit of rows in the last 24 hours. */
function requireDailyRoom(ctx: Ctx, actor: Actor, userId: number, permission: DailyLimit): void {
  // -1 is unlimited, and so is 0: it is what a group with no entry resolves to, and a member
  // must not be shut out of writing because a group was made before the limit existed. Taking
  // writing away is what the forum, profile and conversation permissions are for.
  const limit = permissionValue(ctx, actor, permission as IntegerPermissionId);
  if (limit <= 0) return;
  const { noun, sql } = dailyLimits[permission];
  const made = prepared(ctx, `moderation.${permission}`, () =>
    ctx.sqlite.prepare<{ n: number }, [number, number, number]>(sql),
  ).get(userId, ctx.now() - DAY, limit)!.n;
  if (made >= limit)
    throw new RateLimitedError(
      `You have reached your limit of ${limit} ${noun} in 24 hours. Try again later.`,
    );
}

function requireFloodRoom(ctx: Ctx, actor: Actor, userId: number): void {
  const seconds = readSiteSettings(ctx).floodSeconds;
  if (seconds === 0 || can(ctx, actor, "antispam.bypassFlood")) return;
  let newest = 0;
  for (const [index, sql] of floodClockSql.entries()) {
    const row = prepared(ctx, `moderation.floodClock.${index}`, () =>
      ctx.sqlite.prepare<{ created_at: number }, [number]>(sql),
    ).get(userId);
    if (row && row.created_at > newest) newest = row.created_at;
  }
  const wait = newest + seconds * 1000 - ctx.now();
  if (wait > 0)
    throw new RateLimitedError(
      `Please wait ${Math.ceil(wait / 1000)} seconds before posting again.`,
    );
}

/**
 * Call inside the write transaction, before the insert: refuses with RateLimitedError when the
 * member writes again sooner than the site's flood interval, or has used up a daily limit that
 * applies to `kind`. A new thread also counts as a post.
 */
export const requireWriteRoom = markPublic(
  "Callers authorize the write first; this only limits how fast a member makes it.",
  function requireWriteRoom(ctx: Ctx, actor: Actor, kind: WriteKind): void {
    const userId = actorUserId(actor);
    if (userId === null) return;
    requireFloodRoom(ctx, actor, userId);
    if (kind === "thread") requireDailyRoom(ctx, actor, userId, "antispam.threadsPerDay");
    if (kind === "thread" || kind === "reply")
      requireDailyRoom(ctx, actor, userId, "antispam.postsPerDay");
    if (kind === "conversation")
      requireDailyRoom(ctx, actor, userId, "antispam.conversationsPerDay");
  },
);

/** Call inside the write transaction when a member adds a reaction whose score is negative. */
export const requireNegativeReactionRoom = markPublic(
  "Callers authorize the reaction first; this only limits how many negative ones a member gives.",
  function requireNegativeReactionRoom(ctx: Ctx, actor: Actor): void {
    const userId = actorUserId(actor);
    if (userId !== null) requireDailyRoom(ctx, actor, userId, "antispam.negativeReactionsPerDay");
  },
);
