import { type Actor, actorUserId } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { can } from "../../permissions";
import { requireComment, requirePost, requireProfileView } from "../profiles/shared";

type Content = {
  state: string;
  user_id: number;
  node_id?: number;
  thread_state?: string;
  thread_user_id?: number;
};

function one(ctx: Ctx, name: string, sql: string, id: number): Content | null {
  return (
    prepared(ctx, `email.visible.${name}`, () => ctx.sqlite.prepare<Content, [number]>(sql)).get(
      id,
    ) ?? null
  );
}

function forumVisible(ctx: Ctx, actor: Actor, row: Content): boolean {
  const nodeId = row.node_id;
  if (nodeId === undefined || !can(ctx, actor, "node.view", { nodeId })) return false;
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
): boolean {
  if (actor.kind === "guest") return false;
  if (contentType === "thread") {
    const row = one(
      ctx,
      "thread",
      "SELECT state, user_id, node_id FROM threads WHERE id = ?1",
      contentId,
    );
    return !!row && forumVisible(ctx, actor, row);
  }
  if (contentType === "post") {
    const row = one(
      ctx,
      "post",
      "SELECT p.state, p.user_id, t.node_id, t.state AS thread_state, t.user_id AS thread_user_id FROM posts p JOIN threads t ON t.id = p.thread_id WHERE p.id = ?1",
      contentId,
    );
    return !!row && forumVisible(ctx, actor, row);
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
  if (contentType === "announcement") {
    return !!prepared(ctx, "email.visible.announcement", () =>
      ctx.sqlite.prepare<{ id: number }, [number]>("SELECT id FROM announcements WHERE id = ?1"),
    ).get(contentId);
  }
  if (threadId !== null) {
    const row = one(
      ctx,
      "relatedThread",
      "SELECT state, user_id, node_id FROM threads WHERE id = ?1",
      threadId,
    );
    return !!row && forumVisible(ctx, actor, row);
  }
  return false;
}
