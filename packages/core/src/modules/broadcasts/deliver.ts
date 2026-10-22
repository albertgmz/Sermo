import { type Ctx, prepared } from "../../context";
import { GROUP_IDS } from "../../db/schema";
import {
  can,
  currentVersions,
  memberActor,
  PRINCIPAL_COLUMNS,
  type PrincipalRow,
} from "../../permissions";
import { storeContentReferences, storeSpoilers } from "../../render";
import { deliverDirect } from "../notifications/direct";

/** A private message to send, rendered once for all its recipients. */
export type MessageContent = {
  kind: "message";
  senderId: number;
  title: string;
  source: string;
  html: string;
  spoilers: string[];
  mentionedUserIds: number[];
  quotes: { postId: number; userId: number }[];
  locked: boolean;
  removeFromSender: boolean;
};
export type AlertContent = { kind: "alert"; text: string; url: string | null };
export type StoredContent = MessageContent | AlertContent;

/** A member who may be written to: the row the permission checks read. */
export type Recipient = PrincipalRow & { id: number; group_id: number };

/**
 * Members who are never written to: erased, banned, unconfirmed or awaiting approval. `?2` is the
 * time. Aliased `u`.
 */
export const REACHABLE_SQL =
  "u.erased_at IS NULL AND u.banned_permanently = 0 AND (u.banned_until IS NULL OR u.banned_until <= ?2) " +
  `AND u.group_id <> ${GROUP_IDS.unconfirmed} AND u.signup_review IS NULL`;

/** The reachable members among `ids`, with what the permission checks need. */
export function reachable(ctx: Ctx, ids: readonly number[]): Recipient[] {
  return prepared(ctx, "broadcasts.reachable", () =>
    ctx.sqlite.prepare<Recipient, [string, number]>(
      `SELECT u.id, u.group_id, ${PRINCIPAL_COLUMNS} FROM users u WHERE u.id IN (SELECT value FROM json_each(?1)) AND ${REACHABLE_SQL} ORDER BY u.id`,
    ),
  ).all(JSON.stringify(ids), ctx.now());
}

export type Outcome = { sent: number; skipped: number; conversationIds: Map<number, number> };

/**
 * One conversation per recipient, started by the sender: the same message in each, the sender in
 * it (or, with `removeFromSender`, out of it and not brought back by replies), and the recipient
 * alerted that they were added. A recipient who is the sender gets a conversation of their own,
 * whatever the option says. Members without `conversation.receive` are skipped; the members'
 * ignore lists are not read, as staff messages go through them. No events are published: the
 * alerts are written in one batch. Call it in the caller's write transaction.
 */
export function deliverMessages(
  ctx: Ctx,
  content: MessageContent,
  recipients: readonly Recipient[],
  dryRun = false,
): Outcome {
  const versions = currentVersions(ctx);
  const now = ctx.now();
  const conversationIds = new Map<number, number>();
  for (const recipient of recipients) {
    if (
      !can(
        ctx,
        memberActor(recipient.id, recipient.group_id, recipient, versions),
        "conversation.receive",
      )
    )
      continue;
    const self = recipient.id === content.senderId;
    // The sender is a second participant unless they are the recipient or leave the list.
    const senderStays = !self;
    const participants = senderStays && !content.removeFromSender ? 2 : 1;
    const conversationId = Number(
      prepared(ctx, "broadcasts.insertConversation", () =>
        ctx.sqlite.prepare(
          "INSERT INTO conversations (title, user_id, created_at, last_message_at, last_message_user_id, message_count, participant_count, is_locked) VALUES (?1, ?2, ?3, ?3, ?2, 1, ?4, ?5)",
        ),
      ).run(content.title, content.senderId, now, participants, Number(content.locked))
        .lastInsertRowid,
    );
    const messageId = Number(
      prepared(ctx, "broadcasts.insertMessage", () =>
        ctx.sqlite.prepare(
          "INSERT INTO conversation_messages (conversation_id, user_id, state, created_at, body_source, body_html) VALUES (?1, ?2, 'visible', ?3, ?4, ?5)",
        ),
      ).run(conversationId, content.senderId, now, content.source, content.html).lastInsertRowid,
    );
    if (content.spoilers.length)
      storeSpoilers(ctx, "conversation_message", messageId, content.spoilers);
    if (content.mentionedUserIds.length || content.quotes.length)
      storeContentReferences(ctx, "conversation_message", messageId, content);
    prepared(ctx, "broadcasts.setFirstMessage", () =>
      ctx.sqlite.prepare("UPDATE conversations SET last_message_id = ?1 WHERE id = ?2"),
    ).run(messageId, conversationId);
    const insert = prepared(ctx, "broadcasts.insertParticipant", () =>
      ctx.sqlite.prepare(
        "INSERT INTO conversation_participants (conversation_id, user_id, state, joined_at, last_message_at, last_read_message_id) VALUES (?1, ?2, ?3, ?4, ?4, ?5)",
      ),
    );
    if (senderStays)
      insert.run(
        conversationId,
        content.senderId,
        content.removeFromSender ? "left_ignored" : "active",
        now,
        messageId,
      );
    // The sender who is the recipient has read their own message.
    insert.run(conversationId, recipient.id, "active", now, self ? messageId : 0);
    conversationIds.set(recipient.id, conversationId);
  }
  const alerted = [...conversationIds].filter(([id]) => id !== content.senderId);
  deliverDirect(
    ctx,
    "conversation.added",
    content.senderId,
    alerted.map(([userId, conversationId]) => ({
      userId,
      contentType: "conversation",
      contentId: conversationId,
      data: {},
    })),
    dryRun,
  );
  return {
    sent: conversationIds.size,
    skipped: recipients.length - conversationIds.size,
    conversationIds,
  };
}

/** The alert in one batch: members who turned `admin.alert` off in-app are skipped. */
export function deliverAlerts(
  ctx: Ctx,
  content: AlertContent,
  recipients: readonly Recipient[],
  runId: number,
  dryRun = false,
): Outcome {
  const alerted = deliverDirect(
    ctx,
    "admin.alert",
    null,
    recipients.map((recipient) => ({
      userId: recipient.id,
      contentType: "admin_alert",
      contentId: runId,
      data: { message: content.text, ...(content.url === null ? {} : { url: content.url }) },
    })),
    dryRun,
  );
  return {
    sent: alerted.size,
    skipped: recipients.length - alerted.size,
    conversationIds: new Map(),
  };
}
