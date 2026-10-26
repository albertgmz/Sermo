import { type Actor, actorUserId } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { can } from "../../permissions";
import { readGates } from "../forums/read-gates";
import { requireComment, requirePost, requireProfileView } from "../profiles/shared";
import { blockedAmong } from "../social/blocks";

type Content = {
  state: string;
  user_id: number;
  node_id?: number;
  thread_state?: string;
  thread_user_id?: number;
  /** The thread's own +18 mark. */
  is_adult: number;
};

function one(ctx: Ctx, name: string, sql: string, id: number): Content | null {
  return (
    prepared(ctx, `email.visible.${name}`, () => ctx.sqlite.prepare<Content, [number]>(sql)).get(
      id,
    ) ?? null
  );
}

function forumVisible(ctx: Ctx, actor: Actor, row: Content, blocks: boolean): boolean {
  const nodeId = row.node_id;
  if (nodeId === undefined || !can(ctx, actor, "node.view", { nodeId })) return false;
  // Threads of other members may be closed to the recipient in this forum.
  const gates = readGates(ctx, actor);
  const threadUserId = row.thread_user_id ?? row.user_id;
  if (!gates.opens(nodeId, threadUserId)) return false;
  // Nothing of a member in a block with the recipient (their threads, their posts), except an
  // official notice (`blocks` false), which always arrives.
  if (blocks && blockedAmong(ctx, actor, [threadUserId, row.user_id]).size > 0) return false;
  if (gates.hidesAdult({ is_adult: row.is_adult, user_id: threadUserId })) return false;
  if (row.thread_state && row.thread_state !== "visible") {
    const threadAllowed =
      (row.thread_state === "moderated" && row.thread_user_id === actorUserId(actor)) ||
      can(
        ctx,
        actor,
        row.thread_state === "deleted" ? "forum.viewDeleted" : "forum.viewModerated",
        { nodeId },
      );
    if (!threadAllowed) return false;
  }
  if (row.state === "visible") return true;
  if (row.state === "moderated" && row.user_id === actorUserId(actor)) return true;
  return can(ctx, actor, row.state === "deleted" ? "forum.viewDeleted" : "forum.viewModerated", {
    nodeId,
  });
}

export function visibleTo(
  ctx: Ctx,
  actor: Actor,
  contentType: string,
  contentId: number,
  threadId: number | null,
  // False for an official notice: a block does not hold it back.
  blocks = true,
): boolean {
  if (actor.kind === "guest") return false;
  if (contentType === "thread") {
    const row = one(
      ctx,
      "thread",
      "SELECT state, user_id, node_id, is_adult FROM threads WHERE id = ?1",
      contentId,
    );
    return !!row && forumVisible(ctx, actor, row, blocks);
  }
  if (contentType === "post") {
    const row = one(
      ctx,
      "post",
      "SELECT p.state, p.user_id, t.node_id, t.state AS thread_state, t.user_id AS thread_user_id, t.is_adult FROM posts p JOIN threads t ON t.id = p.thread_id WHERE p.id = ?1",
      contentId,
    );
    return !!row && forumVisible(ctx, actor, row, blocks);
  }
  if (contentType === "conversation" || contentType === "conversation_message") {
    const conversationId =
      contentType === "conversation"
        ? contentId
        : one(
            ctx,
            "conversationMessage",
            "SELECT m.state, m.user_id, m.conversation_id AS node_id FROM conversation_messages m WHERE m.id = ?1",
            contentId,
          )?.node_id;
    if (!conversationId) return false;
    const participant = prepared(ctx, "email.visible.participant", () =>
      ctx.sqlite.prepare<{ state: string }, [number, number]>(
        "SELECT state FROM conversation_participants WHERE conversation_id = ?1 AND user_id = ?2",
      ),
    ).get(conversationId, actor.userId);
    if (participant?.state !== "active") return false;
    if (contentType === "conversation_message") {
      const message = one(
        ctx,
        "messageState",
        "SELECT state, user_id FROM conversation_messages WHERE id = ?1",
        contentId,
      );
      return message?.state === "visible";
    }
    return true;
  }
  if (contentType === "profile_post" || contentType === "profile_post_comment") {
    try {
      if (contentType === "profile_post") requirePost(ctx, actor, contentId);
      else requireComment(ctx, actor, contentId);
      return true;
    } catch {
      return false;
    }
  }
  if (contentType === "user" || contentType === "profile") {
    try {
      requireProfileView(ctx, actor, contentId);
      return true;
    } catch {
      return false;
    }
  }
  // A staff alert holds its own text; nothing it names can be hidden from the member.
  if (contentType === "admin_alert") return true;
  if (contentType === "announcement") {
    return !!prepared(ctx, "email.visible.announcement", () =>
      ctx.sqlite.prepare<{ id: number }, [number]>("SELECT id FROM announcements WHERE id = ?1"),
    ).get(contentId);
  }
  if (threadId !== null) {
    const row = one(
      ctx,
      "relatedThread",
      "SELECT state, user_id, node_id, is_adult FROM threads WHERE id = ?1",
      threadId,
    );
    return !!row && forumVisible(ctx, actor, row, blocks);
  }
  return false;
}
