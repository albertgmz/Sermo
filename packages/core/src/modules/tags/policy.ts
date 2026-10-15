import { type Actor, actorUserId } from "../../actor";
import type { Ctx } from "../../context";
import { ForbiddenError } from "../../errors";
import { can } from "../../permissions";
import type { HashtagRules } from "../../render";
import { knownTagNames, newTagKeys } from "./store";

type TagThread = { id: number; node_id: number; user_id: number; is_locked: number };

/** Whether a posting restriction is on the member now (read from the row, as a request's actor may predate it). */
function postingRestricted(ctx: Ctx, actor: Actor): boolean {
  const userId = actorUserId(actor);
  if (userId === null) return false;
  const until = ctx.sqlite
    .prepare<{ until: number | null }, [number]>(
      "SELECT restricted_posting_until AS until FROM users WHERE id = ?1",
    )
    .get(userId)?.until;
  return until != null && until > ctx.now();
}

/**
 * What a member may do to the tags of a thread. Who may touch them at all: the thread's author
 * while it is unlocked, and staff (whoever may edit any thread of the forum, or manage tags). That
 * is the right to `remove`; it needs no tag.apply, so a muted author or moderator can still take a
 * tag off. `add` also needs tag.apply (which a posting restriction takes away), or tag.manage
 * without a restriction: a curator may fix the tags of any thread. None of it depends on the
 * title-edit time limit or on the forum being read-only.
 */
export function tagRights(
  ctx: Ctx,
  actor: Actor,
  thread: Pick<TagThread, "node_id" | "user_id" | "is_locked">,
): { add: boolean; remove: boolean } {
  const manages = can(ctx, actor, "tag.manage");
  const remove =
    manages ||
    can(ctx, actor, "forum.editAny", { nodeId: thread.node_id }) ||
    (!thread.is_locked && thread.user_id === actorUserId(actor));
  const add =
    remove && (can(ctx, actor, "tag.apply") || (manages && !postingRestricted(ctx, actor)));
  return { add, remove };
}

/** Whether tags may be added to a thread by this member (the opening post's hashtags, a new list). */
export function mayTag(
  ctx: Ctx,
  actor: Actor,
  thread: Pick<TagThread, "node_id" | "user_id" | "is_locked">,
): boolean {
  return tagRights(ctx, actor, thread).add;
}

/**
 * A new list of tags for a thread: taking tags off needs the right to remove; any tag the thread
 * does not carry yet needs the right to add, and the right to create a tag nobody can see used.
 */
export function requireTagChange(ctx: Ctx, actor: Actor, thread: TagThread, keys: string[]): void {
  const rights = tagRights(ctx, actor, thread);
  if (!rights.remove) throw new ForbiddenError();
  const added = newTagKeys(ctx, thread.id, keys);
  if (added.length === 0) return;
  if (!rights.add)
    throw new ForbiddenError("You may take tags off this thread but not put new ones on it.");
  requireTagCreate(ctx, actor, added);
}

/**
 * A listed tag nobody used yet needs tag.create; one the writer can see in use (under any name)
 * does not. A tag used only where the writer cannot look counts as new, so the answer does not
 * tell them it exists.
 */
export function requireTagCreate(ctx: Ctx, actor: Actor, keys: string[]): void {
  if (keys.length === 0 || can(ctx, actor, "tag.create")) return;
  const known = knownTagNames(ctx, actor, keys);
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
