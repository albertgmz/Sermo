import * as z from "zod";
import type { Actor } from "../../actor";
import { requireAuthenticated } from "../../actor";
import { type Ctx, prepared } from "../../context";
import {
  conversationsCreate,
  conversationsGet,
  conversationsLeave,
  conversationsList,
  conversationsListMessages,
  conversationsMarkRead,
  conversationsReply,
} from "../../contracts/conversations";
import { writeTx } from "../../db/tx";
import { ForbiddenError, NotFoundError, ValidationError } from "../../errors";
import { publishEvent } from "../../events";
import { implement } from "../../operation";
import { decodeCursor, encodeCursor } from "../../pagination";
import { renderMarkdown } from "../../render";
import { loadViewerReactions, reactionSummary } from "../../shared/reactions";
import { loadUserSummaries } from "../../shared/users";
import { iso } from "../../time";
import { loadAttachments, setAttachments, validateEmbeddedAttachments } from "../attachments";
import { getGlobalPermissions } from "../permissions";

interface ConversationRow {
  id: number;
  title: string;
  user_id: number;
  created_at: number;
  last_message_at: number;
  last_message_id: number;
  last_message_user_id: number;
  message_count: number;
  participant_count: number;
  last_read_message_id: number;
}
interface ParticipantRow {
  user_id: number;
  state: "active" | "left";
}
interface MessageRow {
  id: number;
  conversation_id: number;
  user_id: number;
  state: "visible" | "moderated" | "deleted";
  created_at: number;
  body_html: string;
  reaction_counts: string;
  attachment_count: number;
}

export const inboxSql =
  "SELECT c.*, cp.last_read_message_id FROM conversation_participants cp JOIN conversations c ON c.id = cp.conversation_id WHERE cp.user_id = ?1 AND cp.state = 'active' AND (cp.last_message_at, cp.conversation_id) < (?2, ?3) ORDER BY cp.last_message_at DESC, cp.conversation_id DESC LIMIT ?4";
export const participantsSql =
  "SELECT user_id, state FROM conversation_participants WHERE conversation_id = ?1 ORDER BY user_id";
export const messagesSql =
  "SELECT id, conversation_id, user_id, state, created_at, body_html, reaction_counts, attachment_count FROM conversation_messages WHERE conversation_id = ?1 AND id > ?2 ORDER BY id LIMIT ?3";
export const activeSql =
  "SELECT c.*, cp.last_read_message_id FROM conversation_participants cp JOIN conversations c ON c.id = cp.conversation_id WHERE cp.conversation_id = ?1 AND cp.user_id = ?2 AND cp.state = 'active'";
export const reactableSql =
  "SELECT m.user_id, m.state FROM conversation_messages m JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id WHERE m.id = ?1 AND cp.user_id = ?2 AND cp.state = 'active'";

function activeConversation(ctx: Ctx, actor: Actor, id: number): ConversationRow {
  const user = requireAuthenticated(actor);
  const row = prepared(ctx, "conversations.active", () =>
    ctx.sqlite.prepare<ConversationRow, [number, number]>(activeSql),
  ).get(id, user.userId);
  if (!row) throw new NotFoundError();
  return row;
}

function summary(row: ConversationRow, user: ReturnType<typeof loadUserSummaries>) {
  return {
    id: row.id,
    title: row.title,
    starter: user(row.user_id),
    createdAt: iso(row.created_at),
    lastMessage: {
      messageId: row.last_message_id,
      sentAt: iso(row.last_message_at),
      user: user(row.last_message_user_id),
    },
    messageCount: row.message_count,
    participantCount: row.participant_count,
    isUnread: row.last_message_id > row.last_read_message_id,
  };
}

function fullConversation(ctx: Ctx, row: ConversationRow) {
  const participants = prepared(ctx, "conversations.participants", () =>
    ctx.sqlite.prepare<ParticipantRow, [number]>(participantsSql),
  ).all(row.id);
  const user = loadUserSummaries(ctx, [
    row.user_id,
    row.last_message_user_id,
    ...participants.map((p) => p.user_id),
  ]);
  return {
    ...summary(row, user),
    participants: participants.map((p) => ({ user: user(p.user_id), state: p.state })),
    canReply: true,
  };
}

function messages(ctx: Ctx, actor: Actor, rows: MessageRow[]) {
  const user = loadUserSummaries(
    ctx,
    rows.map((r) => r.user_id),
  );
  const viewer = loadViewerReactions(
    ctx,
    actor,
    "conversation_message",
    rows.map((r) => r.id),
  );
  const attachments = loadAttachments(
    ctx,
    "conversation_message",
    rows.map((r) => r.id),
  );
  return rows.map((r) => ({
    id: r.id,
    conversationId: r.conversation_id,
    author: user(r.user_id),
    state: r.state,
    createdAt: iso(r.created_at),
    bodyHtml: r.body_html,
    attachmentCount: r.attachment_count,
    attachments: attachments.get(r.id) ?? [],
    reactions: reactionSummary(r.reaction_counts, viewer.get(r.id)),
  }));
}

function newMessage(
  id: number,
  conversationId: number,
  author: ReturnType<typeof loadUserSummaries>,
  authorId: number,
  now: number,
  html: string,
  attachments: ReturnType<typeof loadAttachments>,
) {
  return {
    id,
    conversationId,
    author: author(authorId),
    state: "visible" as const,
    createdAt: iso(now),
    bodyHtml: html,
    attachmentCount: attachments.get(id)?.length ?? 0,
    attachments: attachments.get(id) ?? [],
    reactions: { counts: {}, total: 0, mine: null },
  };
}

export const conversationsListOp = implement(conversationsList, (ctx, actor, input) => {
  const user = requireAuthenticated(actor);
  const [at, id] = input.cursor
    ? decodeCursor(input.cursor, z.tuple([z.number().int(), z.number().int()]))
    : [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];
  const rows = prepared(ctx, "conversations.inbox", () =>
    ctx.sqlite.prepare<ConversationRow, [number, number, number, number]>(inboxSql),
  ).all(user.userId, at, id, input.limit + 1);
  const page = rows.slice(0, input.limit);
  const users = loadUserSummaries(
    ctx,
    page.flatMap((r) => [r.user_id, r.last_message_user_id]),
  );
  const last = page.at(-1);
  return {
    items: page.map((r) => summary(r, users)),
    nextCursor:
      rows.length > input.limit && last ? encodeCursor([last.last_message_at, last.id]) : null,
  };
});

export const conversationsGetOp = implement(conversationsGet, (ctx, actor, input) =>
  fullConversation(ctx, activeConversation(ctx, actor, input.conversationId)),
);

export const conversationsCreateOp = implement(conversationsCreate, (ctx, actor, input) => {
  const starter = requireAuthenticated(actor);
  if (!getGlobalPermissions(ctx, actor).canStartConversations) throw new ForbiddenError();
  const ids = [...new Set(input.recipientIds)].filter((id) => id !== starter.userId);
  if (!ids.length) throw new ValidationError("At least one other recipient is required.");
  const found = new Set(
    prepared(ctx, "conversations.recipientIds", () =>
      ctx.sqlite.prepare<{ id: number }, [string]>(
        "SELECT id FROM users WHERE id IN (SELECT value FROM json_each(?1))",
      ),
    )
      .all(JSON.stringify(ids))
      .map((r) => r.id),
  );
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length) {
    const message = `Unknown recipient IDs: ${missing.join(", ")}.`;
    throw new ValidationError(message, [{ path: ["recipientIds"], message }]);
  }
  const html = renderMarkdown(input.body);
  const now = ctx.now();
  const { conversationId, messageId } = writeTx(ctx, () => {
    const conversationId = Number(
      prepared(ctx, "conversations.insertConversation", () =>
        ctx.sqlite.prepare(
          "INSERT INTO conversations (title, user_id, created_at, last_message_at, last_message_user_id, message_count, participant_count) VALUES (?1, ?2, ?3, ?3, ?2, 1, ?4)",
        ),
      ).run(input.title, starter.userId, now, ids.length + 1).lastInsertRowid,
    );
    const messageId = Number(
      prepared(ctx, "conversations.insertMessage", () =>
        ctx.sqlite.prepare(
          "INSERT INTO conversation_messages (conversation_id, user_id, state, created_at, body_source, body_html) VALUES (?1, ?2, 'visible', ?3, ?4, ?5)",
        ),
      ).run(conversationId, starter.userId, now, input.body, html).lastInsertRowid,
    );
    setAttachments(
      ctx,
      starter.userId,
      "conversation_message",
      messageId,
      input.attachmentIds ?? [],
    );
    validateEmbeddedAttachments(ctx, "conversation_message", messageId, html);
    prepared(ctx, "conversations.setFirstMessage", () =>
      ctx.sqlite.prepare("UPDATE conversations SET last_message_id = ?1 WHERE id = ?2"),
    ).run(messageId, conversationId);
    const insert = prepared(ctx, "conversations.insertParticipant", () =>
      ctx.sqlite.prepare(
        "INSERT INTO conversation_participants (conversation_id, user_id, state, joined_at, last_message_at, last_read_message_id) VALUES (?1, ?2, 'active', ?3, ?3, ?4)",
      ),
    );
    insert.run(conversationId, starter.userId, now, messageId);
    for (const id of ids) insert.run(conversationId, id, now, 0);
    publishEvent(ctx, {
      type: "content.created",
      targetType: "conversation_message",
      targetId: messageId,
      payload: { conversationId },
    });
    return { conversationId, messageId };
  });
  const participantIds = [starter.userId, ...ids].sort((a, b) => a - b);
  const user = loadUserSummaries(ctx, participantIds);
  const row: ConversationRow = {
    id: conversationId,
    title: input.title,
    user_id: starter.userId,
    created_at: now,
    last_message_at: now,
    last_message_id: messageId,
    last_message_user_id: starter.userId,
    message_count: 1,
    participant_count: participantIds.length,
    last_read_message_id: messageId,
  };
  return {
    conversation: {
      ...summary(row, user),
      participants: participantIds.map((id) => ({ user: user(id), state: "active" as const })),
      canReply: true,
    },
    message: newMessage(
      messageId,
      conversationId,
      user,
      starter.userId,
      now,
      html,
      loadAttachments(ctx, "conversation_message", [messageId]),
    ),
  };
});

export const conversationsReplyOp = implement(conversationsReply, (ctx, actor, input) => {
  const user = requireAuthenticated(actor);
  activeConversation(ctx, actor, input.conversationId);
  const html = renderMarkdown(input.body);
  const now = ctx.now();
  const messageId = writeTx(ctx, () => {
    activeConversation(ctx, actor, input.conversationId);
    const id = Number(
      prepared(ctx, "conversations.insertMessage", () =>
        ctx.sqlite.prepare(
          "INSERT INTO conversation_messages (conversation_id, user_id, state, created_at, body_source, body_html) VALUES (?1, ?2, 'visible', ?3, ?4, ?5)",
        ),
      ).run(input.conversationId, user.userId, now, input.body, html).lastInsertRowid,
    );
    setAttachments(ctx, user.userId, "conversation_message", id, input.attachmentIds ?? []);
    validateEmbeddedAttachments(ctx, "conversation_message", id, html);
    prepared(ctx, "conversations.updateLastMessage", () =>
      ctx.sqlite.prepare(
        "UPDATE conversations SET last_message_at = ?1, last_message_id = ?2, last_message_user_id = ?3, message_count = message_count + 1 WHERE id = ?4",
      ),
    ).run(now, id, user.userId, input.conversationId);
    prepared(ctx, "conversations.updateParticipantActivity", () =>
      ctx.sqlite.prepare(
        "UPDATE conversation_participants SET last_message_at = ?1 WHERE conversation_id = ?2 AND state = 'active'",
      ),
    ).run(now, input.conversationId);
    prepared(ctx, "conversations.updateReadState", () =>
      ctx.sqlite.prepare(
        "UPDATE conversation_participants SET last_read_message_id = ?1 WHERE conversation_id = ?2 AND user_id = ?3",
      ),
    ).run(id, input.conversationId, user.userId);
    publishEvent(ctx, {
      type: "content.created",
      targetType: "conversation_message",
      targetId: id,
      payload: { conversationId: input.conversationId },
    });
    return id;
  });
  const author = loadUserSummaries(ctx, [user.userId]);
  return newMessage(
    messageId,
    input.conversationId,
    author,
    user.userId,
    now,
    html,
    loadAttachments(ctx, "conversation_message", [messageId]),
  );
});

export const conversationsListMessagesOp = implement(
  conversationsListMessages,
  (ctx, actor, input) => {
    activeConversation(ctx, actor, input.conversationId);
    const id = input.cursor
      ? decodeCursor(input.cursor, z.tuple([z.number().int().nonnegative()]))[0]
      : 0;
    const rows = prepared(ctx, "conversations.messages", () =>
      ctx.sqlite.prepare<MessageRow, [number, number, number]>(messagesSql),
    ).all(input.conversationId, id, input.limit + 1);
    const page = rows.slice(0, input.limit);
    const last = page.at(-1);
    return {
      items: messages(ctx, actor, page),
      nextCursor: rows.length > input.limit && last ? encodeCursor([last.id]) : null,
    };
  },
);

export const conversationsMarkReadOp = implement(conversationsMarkRead, (ctx, actor, input) => {
  const user = requireAuthenticated(actor);
  writeTx(ctx, () => {
    const row = activeConversation(ctx, actor, input.conversationId);
    prepared(ctx, "conversations.updateReadState", () =>
      ctx.sqlite.prepare(
        "UPDATE conversation_participants SET last_read_message_id = ?1 WHERE conversation_id = ?2 AND user_id = ?3",
      ),
    ).run(row.last_message_id, row.id, user.userId);
  });
  return { ok: true as const };
});

export const conversationsLeaveOp = implement(conversationsLeave, (ctx, actor, input) => {
  const user = requireAuthenticated(actor);
  writeTx(ctx, () => {
    activeConversation(ctx, actor, input.conversationId);
    prepared(ctx, "conversations.markLeft", () =>
      ctx.sqlite.prepare(
        "UPDATE conversation_participants SET state = 'left' WHERE conversation_id = ?1 AND user_id = ?2",
      ),
    ).run(input.conversationId, user.userId);
    prepared(ctx, "conversations.decrementParticipants", () =>
      ctx.sqlite.prepare(
        "UPDATE conversations SET participant_count = participant_count - 1 WHERE id = ?1",
      ),
    ).run(input.conversationId);
  });
  return { ok: true as const };
});

/** For reactions: return the message only to active participants. */
export function reactableConversationMessage(
  ctx: Ctx,
  actor: Actor,
  messageId: number,
): { authorId: number; isVisible: boolean } {
  if (actor.kind === "guest") throw new NotFoundError();
  const row = prepared(ctx, "conversations.reactable", () =>
    ctx.sqlite.prepare<{ user_id: number; state: string }, [number, number]>(reactableSql),
  ).get(messageId, actor.userId);
  if (!row) throw new NotFoundError();
  return { authorId: row.user_id, isVisible: row.state === "visible" };
}

export const operations = [
  conversationsListOp,
  conversationsGetOp,
  conversationsCreateOp,
  conversationsReplyOp,
  conversationsListMessagesOp,
  conversationsMarkReadOp,
  conversationsLeaveOp,
];
