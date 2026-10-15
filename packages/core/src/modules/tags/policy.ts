import { type Actor, actorUserId } from "../../actor";
import type { Ctx } from "../../context";
import { ForbiddenError } from "../../errors";
import { can } from "../../permissions";
import type { HashtagRules } from "../../render";
import { resolveTagNames } from "./store";

/**
 * Who may set the tags of a thread: the thread's author while it is unlocked, and staff (whoever
 * may edit any thread of the forum, or manage tags), each also holding tag.apply unless they
 * manage tags.
 */
export function mayTag(
  ctx: Ctx,
  actor: Actor,
  thread: { node_id: number; user_id: number; is_locked: number },
): boolean {
  if (can(ctx, actor, "tag.manage")) return true;
  if (!can(ctx, actor, "tag.apply")) return false;
  return (
    can(ctx, actor, "forum.editAny", { nodeId: thread.node_id }) ||
    (!thread.is_locked && thread.user_id === actorUserId(actor))
  );
}

/** A listed tag nobody used yet needs tag.create; one that exists (under any name) does not. */
export function requireTagCreate(ctx: Ctx, actor: Actor, keys: string[]): void {
  if (keys.length === 0 || can(ctx, actor, "tag.create")) return;
  const known = resolveTagNames(ctx, keys);
  const unknown = keys.filter((key) => !known.has(key));
  if (unknown.length > 0)
    throw new ForbiddenError(
      `You cannot create new tags (${unknown.map((key) => `#${key}`).join(", ")}).`,
    );
}

/** What the hashtags of an opening post may do for this writer, with `slots` tags to spare. */
export function hashtagRules(ctx: Ctx, actor: Actor, slots: number): HashtagRules {
  return { create: slots > 0 && can(ctx, actor, "tag.create"), slots: Math.max(0, slots) };
}
