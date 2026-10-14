import type { Actor } from "../../actor";
import { actorUserId } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { spoilersGet } from "../../contracts/spoilers";
import type { SpoilerContentType } from "../../db/schema";
import { NotFoundError } from "../../errors";
import { implement } from "../../operation";
import { can } from "../../permissions";
import { activeConversation } from "../conversations";
import { requirePost } from "../forums";
import { requireComment, requirePost as requireProfilePost } from "../profiles/shared";

/**
 * A holder of `conversation.moderate` who is not in the conversation reads a message where the
 * moderation views already show it: awaiting approval, reported (in any state), or a visible
 * message beside one of those in the same conversation.
 */
function moderatorMayRead(
  ctx: Ctx,
  actor: Actor,
  id: number,
  message: { conversation_id: number; state: string },
): boolean {
  if (!can(ctx, actor, "conversation.moderate")) return false;
  if (message.state === "moderated") return true;
  const reported = prepared(ctx, "spoilers.reported", () =>
    ctx.sqlite.prepare<{ found: number }, [number]>(
      "SELECT 1 AS found FROM report_groups WHERE target_type = 'conversation_message' AND target_id = ?1 LIMIT 1",
    ),
  );
  if (reported.get(id)) return true;
  // The approval and report views also show the 3 messages before and after: the visible ones, and
  // the hidden ones too for a holder of conversation.viewHidden.
  const viewHidden = Number(can(ctx, actor, "conversation.viewHidden"));
  if (message.state !== "visible" && !viewHidden) return false;
  return !!prepared(ctx, "spoilers.beside", () =>
    ctx.sqlite.prepare<{ found: number }, [number, number, number]>(
      "SELECT 1 AS found FROM conversation_messages t WHERE t.conversation_id = ?1 AND t.id <> ?2 " +
        "AND (t.state = 'moderated' OR EXISTS (SELECT 1 FROM report_groups g WHERE g.target_type = 'conversation_message' AND g.target_id = t.id)) " +
        "AND ((t.id > ?2 AND (SELECT count(*) FROM conversation_messages m WHERE m.conversation_id = ?1 AND m.id >= ?2 AND m.id < t.id AND (m.state = 'visible' OR ?3 = 1)) <= 3) " +
        "OR (t.id < ?2 AND (SELECT count(*) FROM conversation_messages m WHERE m.conversation_id = ?1 AND m.id <= ?2 AND m.id > t.id AND (m.state = 'visible' OR ?3 = 1)) <= 3)) LIMIT 1",
    ),
  ).get(message.conversation_id, id, viewHidden);
}

/** Throws NotFoundError unless the actor's own read of the item would return it. */
function requireVisible(ctx: Ctx, actor: Actor, type: SpoilerContentType, id: number): void {
  switch (type) {
    case "post":
      requirePost(ctx, actor, id);
      return;
    case "profile_post":
      requireProfilePost(ctx, actor, id);
      return;
    case "profile_post_comment":
      requireComment(ctx, actor, id);
      return;
    case "conversation_message": {
      if (actor.kind === "guest") throw new NotFoundError();
      const message = prepared(ctx, "spoilers.message", () =>
        ctx.sqlite.prepare<{ conversation_id: number; user_id: number; state: string }, [number]>(
          "SELECT conversation_id, user_id, state FROM conversation_messages WHERE id = ?1",
        ),
      ).get(id);
      if (!message) throw new NotFoundError();
      let participant = true;
      try {
        activeConversation(ctx, actor, message.conversation_id);
      } catch (error) {
        if (!(error instanceof NotFoundError)) throw error;
        participant = false;
      }
      if (!participant) {
        if (!moderatorMayRead(ctx, actor, id, message)) throw new NotFoundError();
        return;
      }
      const own = message.user_id === actorUserId(actor);
      if (
        message.state !== "visible" &&
        !(message.state === "moderated" && own) &&
        !can(ctx, actor, "conversation.viewHidden")
      )
        throw new NotFoundError();
      return;
    }
  }
}

export const spoilersGetOp = implement(
  spoilersGet,
  (ctx, actor, input) => {
    requireVisible(ctx, actor, input.contentType, input.contentId);
    const row = prepared(ctx, "spoilers.get", () =>
      ctx.sqlite.prepare<{ html: string }, [string, number, number]>(
        "SELECT html FROM content_spoilers WHERE content_type = ?1 AND content_id = ?2 AND position = ?3",
      ),
    ).get(input.contentType, input.contentId, input.position);
    if (!row) throw new NotFoundError();
    return { html: row.html };
  },
  { public: "Visibility is the item's own read rule, applied by the module that owns the item." },
);

export const operations = [spoilersGetOp];
