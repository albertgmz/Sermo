import { requireAuthenticated } from "../../actor";
import { prepared } from "../../context";
import { reportsViewConversationMessage } from "../../contracts/moderation";
import { writeTx } from "../../db/tx";
import { NotFoundError } from "../../errors";
import { implement } from "../../operation";
import { can, requirePermission } from "../../permissions";
import { iso } from "../../time";
import { appendModeratorLog } from "./index";

type Message = {
  id: number;
  author_id: number;
  author_username: string;
  body_html: string;
  created_at: number;
};

export const reportsViewConversationMessageOp = implement(
  reportsViewConversationMessage,
  (ctx, actor, input) => {
    requireAuthenticated(actor);
    requirePermission(ctx, actor, "conversation.moderate");
    return writeTx(ctx, () => {
      const report = prepared(ctx, "conversationReports.target", () =>
        ctx.sqlite.prepare<
          {
            message_id: number;
            conversation_id: number;
            title: string;
          },
          [number]
        >(
          "SELECT m.id AS message_id, m.conversation_id, c.title FROM report_groups g JOIN conversation_messages m ON m.id = g.target_id JOIN conversations c ON c.id = m.conversation_id WHERE g.id = ?1 AND g.target_type = 'conversation_message'",
        ),
      ).get(input.groupId);
      if (!report) throw new NotFoundError();
      const showHidden = Number(can(ctx, actor, "conversation.viewHidden"));
      const before = prepared(ctx, "conversationReports.before", () =>
        ctx.sqlite.prepare<Message, [number, number, number]>(
          "SELECT m.id, m.user_id AS author_id, u.username AS author_username, m.body_html, m.created_at FROM conversation_messages m JOIN users u ON u.id = m.user_id WHERE m.conversation_id = ?1 AND m.id < ?2 AND (m.state = 'visible' OR ?3 = 1) ORDER BY m.id DESC LIMIT 3",
        ),
      )
        .all(report.conversation_id, report.message_id, showHidden)
        .reverse();
      const center = prepared(ctx, "conversationReports.center", () =>
        ctx.sqlite.prepare<Message, [number]>(
          "SELECT m.id, m.user_id AS author_id, u.username AS author_username, m.body_html, m.created_at FROM conversation_messages m JOIN users u ON u.id = m.user_id WHERE m.id = ?1",
        ),
      ).get(report.message_id)!;
      const after = prepared(ctx, "conversationReports.after", () =>
        ctx.sqlite.prepare<Message, [number, number, number]>(
          "SELECT m.id, m.user_id AS author_id, u.username AS author_username, m.body_html, m.created_at FROM conversation_messages m JOIN users u ON u.id = m.user_id WHERE m.conversation_id = ?1 AND m.id > ?2 AND (m.state = 'visible' OR ?3 = 1) ORDER BY m.id LIMIT 3",
        ),
      ).all(report.conversation_id, report.message_id, showHidden);
      appendModeratorLog(
        ctx,
        actor,
        "conversation_message.view",
        "conversation_message",
        report.message_id,
        "",
        { groupId: input.groupId },
      );
      return {
        conversationId: report.conversation_id,
        title: report.title,
        messages: [...before, center, ...after].map((m) => ({
          id: m.id,
          authorId: m.author_id,
          authorUsername: m.author_username,
          bodyHtml: m.body_html,
          createdAt: iso(m.created_at),
          reported: m.id === report.message_id,
        })),
      };
    });
  },
);
