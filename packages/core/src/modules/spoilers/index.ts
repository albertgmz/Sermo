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
      activeConversation(ctx, actor, message.conversation_id);
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
