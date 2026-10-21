import * as z from "zod";
import type { Actor } from "../../actor";
import { actorUserId, requireAuthenticated } from "../../actor";
import { type Ctx, prepared } from "../../context";
import {
  conversationsAddParticipants,
  conversationsCreate,
  conversationsDeleteMessage,
  conversationsGet,
  conversationsGetMessage,
  conversationsLeave,
  conversationsList,
  conversationsListMessages,
  conversationsLocateMessage,
  conversationsLocateUnread,
  conversationsMarkRead,
  conversationsMarkUnread,
  conversationsRename,
  conversationsReply,
  conversationsSetLocked,
  conversationsUpdateMessage,
} from "../../contracts/conversations";
import type { PARTICIPANT_STATES } from "../../db/schema";
import { writeTx } from "../../db/tx";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../errors";
import { publishEvent } from "../../events";
import { implement, markPublic } from "../../operation";
import { decodeCursor, encodeCursor } from "../../pagination";
import {
  can,
  currentActor,
  memberActor,
  PRINCIPAL_COLUMNS,
  type PrincipalRow,
  permissionsOf,
  requestVersions,
  requirePermission,
} from "../../permissions";
import { storeContentReferences, storeSpoilers } from "../../render";
import { loadViewerReactions, reactionSummary } from "../../shared/reactions";
import { loadUserSummaries } from "../../shared/users";
import { iso, isoOrNull } from "../../time";
import { loadAttachments, setAttachments, validateEmbeddedAttachments } from "../attachments";
import {
  appendModeratorLog,
  moderateEditedContent,
  prepareModeratedContent,
  renderModeratedContent,
  requireWriteRoom,
  withSpamCheck,
} from "../moderation";
import { noticeForOther } from "../moderation/notify";
import { requireTermsAccepted } from "../pages/acceptance";
import { logIp } from "../security/log";

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
  is_locked: number;
  last_read_message_id: number;
}
interface ParticipantRow {
  user_id: number;
  state: (typeof PARTICIPANT_STATES)[number];
}
interface MessageRow {
  id: number;
  conversation_id: number;
  user_id: number;
  state: "visible" | "moderated" | "deleted";
  created_at: number;
  edited_at: number | null;
  body_html: string;
  reaction_counts: string;
  attachment_count: number;
}

/**
 * A hashtag in a message links to a tag that exists. Conversations are private: they never make a
 * tag or tag a thread, and the tag page lists threads only.
 */
const LINK_HASHTAGS = { hashtags: { create: false, slots: 0 } };

export const inboxSql =
  "SELECT c.*, cp.last_read_message_id FROM conversation_participants cp JOIN conversations c ON c.id = cp.conversation_id WHERE cp.user_id = ?1 AND cp.state = 'active' AND (cp.last_message_at, cp.conversation_id) < (?2, ?3) ORDER BY cp.last_message_at DESC, cp.conversation_id DESC LIMIT ?4";
export const participantsSql =
  "SELECT user_id, state FROM conversation_participants WHERE conversation_id = ?1 ORDER BY user_id";
export const messagesSql =
  "SELECT id, conversation_id, user_id, state, created_at, edited_at, body_html, reaction_counts, attachment_count FROM conversation_messages WHERE conversation_id = ?1 AND id > ?2 ORDER BY id LIMIT ?3";
export const visibleMessagesSql =
  "SELECT id, conversation_id, user_id, state, created_at, edited_at, body_html, reaction_counts, attachment_count FROM conversation_messages WHERE conversation_id = ?1 AND id > ?2 AND (state = 'visible' OR (state = 'moderated' AND user_id = ?4) OR ?5 = 1) ORDER BY id LIMIT ?3";
export const visibleMessagesNewestSql =
  "SELECT id, conversation_id, user_id, state, created_at, edited_at, body_html, reaction_counts, attachment_count FROM conversation_messages WHERE conversation_id = ?1 AND id < ?2 AND (state = 'visible' OR (state = 'moderated' AND user_id = ?4) OR ?5 = 1) ORDER BY id DESC LIMIT ?3";
export const participantStatesSql =
  "SELECT user_id, state FROM conversation_participants WHERE conversation_id = ?1 AND user_id IN (SELECT value FROM json_each(?2))";
export const reactivateParticipantSql =
  "UPDATE conversation_participants SET state = 'active', last_message_at = ?1 WHERE conversation_id = ?2 AND user_id = ?3 AND state != 'active'";
// A new reply brings back everyone who left accepting future messages.
export const restoreLeaversSql =
  "UPDATE conversation_participants SET state = 'active', last_message_at = ?1 WHERE conversation_id = ?2 AND state = 'left'";
export const addParticipantSql =
  "INSERT INTO conversation_participants (conversation_id, user_id, state, joined_at, last_message_at, last_read_message_id) VALUES (?1, ?2, 'active', ?3, ?4, ?5)";
export const incrementParticipantsSql =
  "UPDATE conversations SET participant_count = participant_count + ?1 WHERE id = ?2";
export const activeSql =
  "SELECT c.*, cp.last_read_message_id FROM conversation_participants cp JOIN conversations c ON c.id = cp.conversation_id WHERE cp.conversation_id = ?1 AND cp.user_id = ?2 AND cp.state = 'active'";
export const reactableSql =
  "SELECT m.user_id, m.state FROM conversation_messages m JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id WHERE m.id = ?1 AND cp.user_id = ?2 AND cp.state = 'active'";
// Alerts about a conversation: the ones whose content is the conversation (being added), and any
// whose content is one of its messages (a mention), found through the member's own unread rows of the current epoch.
export const clearConversationNoticesSql =
  "UPDATE notifications INDEXED BY notifications_content SET read_at = ?1 WHERE content_type = 'conversation' AND content_id = ?2 AND user_id = ?3 AND epoch = (SELECT notification_epoch FROM users WHERE id = ?3) AND read_at IS NULL";
export const clearMessageNoticesSql =
  "UPDATE notifications INDEXED BY notifications_user_unread_recent SET read_at = ?1 WHERE user_id = ?3 AND content_type = 'conversation_message' AND CAST(json_extract(data, '$.conversationId') AS INTEGER) = ?2 AND epoch = (SELECT notification_epoch FROM users WHERE id = ?3) AND read_at IS NULL";

export const messageSql =
  "SELECT id, conversation_id, user_id, state, created_at, edited_at, body_html, reaction_counts, attachment_count FROM conversation_messages WHERE id = ?1";
export const firstMessageSql =
  "SELECT min(id) AS id FROM conversation_messages WHERE conversation_id = ?1";

export const activeConversation = markPublic(
  "Being an active participant is the check; anyone else gets NotFoundError.",
  function activeConversation(ctx: Ctx, actor: Actor, id: number): ConversationRow {
    const user = requireAuthenticated(actor);
    const row = prepared(ctx, "conversations.active", () =>
      ctx.sqlite.prepare<ConversationRow, [number, number]>(activeSql),
    ).get(id, user.userId);
    if (!row) throw new NotFoundError();
    return row;
  },
);

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

function viewerAbilities(
  permissions: ReturnType<typeof permissionsOf>,
  row: ConversationRow,
  userId: number | null,
) {
  const starter = userId !== null && row.user_id === userId;
  const locked = row.is_locked === 1;
  const moderates = permissions.can("conversation.moderate");
  const canReply = permissions.can("conversation.reply");
  const maxRecipients = permissions.value("conversation.maxRecipients");
  return {
    canReply: canReply && (!locked || moderates),
    isLocked: locked,
    canLock: starter || moderates,
    // Room left under the limit for another active participant besides the starter.
    canInvite:
      starter &&
      permissions.can("conversation.start") &&
      (maxRecipients === -1 || row.participant_count - 1 < maxRecipients),
    canRename: starter && canReply,
  };
}

/** Whether the viewer sees a message in a conversation they take part in. */
function seesMessage(
  permissions: ReturnType<typeof permissionsOf>,
  message: { state: string; user_id: number },
  userId: number,
): boolean {
  return (
    message.state === "visible" ||
    (message.state === "moderated" && message.user_id === userId) ||
    permissions.can("conversation.viewHidden")
  );
}

function mayEdit(
  permissions: ReturnType<typeof permissionsOf>,
  row: ConversationRow,
  message: { user_id: number; state: string; created_at: number },
): boolean {
  return (
    message.state !== "deleted" &&
    (permissions.can("conversation.moderate") ||
      (row.is_locked === 0 &&
        permissions.can("conversation.editOwn", {
          ownerId: message.user_id,
          createdAt: message.created_at,
        })))
  );
}

function mayDelete(
  permissions: ReturnType<typeof permissionsOf>,
  row: ConversationRow,
  message: { id: number; user_id: number; state: string },
  firstId: number | null,
): boolean {
  return (
    message.id !== firstId &&
    message.state !== "deleted" &&
    (permissions.can("conversation.moderate") ||
      (row.is_locked === 0 &&
        permissions.can("conversation.deleteOwn", { ownerId: message.user_id })))
  );
}

function firstMessageId(ctx: Ctx, conversationId: number): number | null {
  return (
    prepared(ctx, "conversations.firstMessage", () =>
      ctx.sqlite.prepare<{ id: number | null }, [number]>(firstMessageSql),
    ).get(conversationId)?.id ?? null
  );
}

function fullConversation(ctx: Ctx, actor: Actor, row: ConversationRow) {
  const permissions = permissionsOf(ctx, actor);
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
    participants: participants.map((p) => ({
      user: user(p.user_id),
      state: p.state === "active" ? ("active" as const) : ("left" as const),
    })),
    ...viewerAbilities(permissions, row, actorUserId(actor)),
  };
}

function messages(ctx: Ctx, actor: Actor, conversation: ConversationRow, rows: MessageRow[]) {
  const permissions = permissionsOf(ctx, actor);
  const viewerId = actorUserId(actor);
  const first = rows.length ? firstMessageId(ctx, conversation.id) : null;
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
    editedAt: isoOrNull(r.edited_at),
    bodyHtml: r.body_html,
    attachmentCount: r.attachment_count,
    attachments: attachments.get(r.id) ?? [],
    reactions: reactionSummary(r.reaction_counts, viewer.get(r.id)),
    canEdit: mayEdit(permissions, conversation, r),
    canDelete: mayDelete(permissions, conversation, r, first),
    // reports.create takes a message the viewer sees only when it is visible or their own.
    canReport:
      permissions.can("report.create") && (r.state === "visible" || r.user_id === viewerId),
  }));
}

function newMessage(
  id: number,
  conversationId: number,
  author: ReturnType<typeof loadUserSummaries>,
  authorId: number,
  now: number,
  html: string,
  state: "visible" | "moderated",
  attachments: ReturnType<typeof loadAttachments>,
  abilities: { canEdit: boolean; canDelete: boolean; canReport: boolean },
) {
  return {
    id,
    conversationId,
    author: author(authorId),
    state,
    createdAt: iso(now),
    editedAt: null,
    bodyHtml: html,
    attachmentCount: attachments.get(id)?.length ?? 0,
    attachments: attachments.get(id) ?? [],
    reactions: { counts: {}, total: 0, mine: null },
    ...abilities,
  };
}

export const conversationsListOp = implement(
  conversationsList,
  (ctx, actor, input) => {
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
  },
  { public: "A member's inbox is limited to active participation." },
);

export const conversationsGetOp = implement(conversationsGet, (ctx, actor, input) =>
  fullConversation(ctx, actor, activeConversation(ctx, actor, input.conversationId)),
);

/**
 * Refuses adding a member whose groups lack `conversation.receive`. One query for the page of
 * recipients; the message does not say who, to match how an ignore refuses.
 */
function requireReceivers(ctx: Ctx, actor: Actor, ids: number[]): void {
  const versions = requestVersions(ctx, actor);
  const rows = prepared(ctx, "conversations.receivers", () =>
    ctx.sqlite.prepare<PrincipalRow & { id: number; group_id: number }, [string]>(
      `SELECT u.id, u.group_id, ${PRINCIPAL_COLUMNS} FROM users u WHERE u.id IN (SELECT value FROM json_each(?1))`,
    ),
  ).all(JSON.stringify(ids));
  for (const row of rows)
    if (!can(ctx, memberActor(row.id, row.group_id, row, versions), "conversation.receive"))
      throw new ForbiddenError("A recipient cannot receive conversations.");
}

/** Attaching files to a message needs `conversation.attach` once a file is added. */
function requireAttach(ctx: Ctx, actor: Actor, ids: number[] | undefined, messageId?: number) {
  if (!ids?.length) return;
  const held = new Set(
    messageId === undefined
      ? []
      : prepared(ctx, "conversations.messageFiles", () =>
          ctx.sqlite.prepare<{ file_id: number }, [number]>(
            "SELECT file_id FROM attachments WHERE content_type = 'conversation_message' AND content_id = ?1",
          ),
        )
          .all(messageId)
          .map((row) => row.file_id),
  );
  if (ids.some((id) => !held.has(id))) requirePermission(ctx, actor, "conversation.attach");
}

function ignoredByRecipient(ctx: Ctx, actor: Actor, starterId: number, ids: number[]): boolean {
  return (
    can(ctx, actor, "member.ignorable") &&
    !can(ctx, actor, "conversation.alwaysInvite") &&
    !!prepared(ctx, "conversations.ignoredRecipients", () =>
      ctx.sqlite.prepare<{ id: number }, [number, string]>(
        "SELECT id FROM user_ignores WHERE ignored_id = ?1 AND user_id IN (SELECT value FROM json_each(?2)) LIMIT 1",
      ),
    ).get(starterId, JSON.stringify(ids))
  );
}

export const conversationsCreateOp = implement(conversationsCreate, (ctx, actor, input) => {
  const starter = requireAuthenticated(actor);
  const permissions = permissionsOf(ctx, actor);
  if (!permissions.can("conversation.start")) throw new ForbiddenError();
  requireTermsAccepted(ctx, actor);
  const ids = [...new Set(input.recipientIds)].filter((id) => id !== starter.userId);
  if (!ids.length) throw new ValidationError("At least one other recipient is required.");
  const maxRecipients = permissions.value("conversation.maxRecipients");
  // Zero means this member cannot add recipients; -1 is unlimited.
  if (maxRecipients !== -1 && ids.length > maxRecipients) {
    const message = `You can add at most ${maxRecipients} recipients.`;
    throw new ValidationError(message, [{ path: ["recipientIds"], message }]);
  }
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
  requireReceivers(ctx, actor, ids);
  requireAttach(ctx, actor, input.attachmentIds);
  if (ignoredByRecipient(ctx, actor, starter.userId, ids)) throw new ForbiddenError();
  return withSpamCheck(ctx, actor, input.body, "message", (spam) => {
    const content = prepareModeratedContent(ctx, actor, input.body, false);
    const refs = renderModeratedContent(ctx, actor, content, LINK_HASHTAGS);
    const html = refs.html;
    const now = ctx.now();
    const { conversationId, messageId } = writeTx(ctx, () => {
      if (ignoredByRecipient(ctx, actor, starter.userId, ids)) throw new ForbiddenError();
      const decision = prepareModeratedContent(ctx, actor, input.body, false);
      if (decision.source !== content.source || decision.moderated !== content.moderated)
        throw new ConflictError("Moderation rules changed; retry.");
      requireWriteRoom(ctx, actor, "conversation", decision.floodSeconds);
      const conversationId = Number(
        prepared(ctx, "conversations.insertConversation", () =>
          ctx.sqlite.prepare(
            "INSERT INTO conversations (title, user_id, created_at, last_message_at, last_message_user_id, message_count, participant_count) VALUES (?1, ?2, ?3, ?3, ?2, ?4, ?5)",
          ),
        ).run(
          input.title,
          starter.userId,
          now,
          Number(!decision.moderated && !spam),
          ids.length + 1,
        ).lastInsertRowid,
      );
      const messageId = Number(
        prepared(ctx, "conversations.insertMessage", () =>
          ctx.sqlite.prepare(
            "INSERT INTO conversation_messages (conversation_id, user_id, state, created_at, body_source, body_html) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
          ),
        ).run(
          conversationId,
          starter.userId,
          decision.moderated || spam ? "moderated" : "visible",
          now,
          refs.source,
          html,
        ).lastInsertRowid,
      );
      storeContentReferences(ctx, "conversation_message", messageId, refs);
      storeSpoilers(ctx, "conversation_message", messageId, refs.spoilers);
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
      for (const id of ids)
        insert.run(conversationId, id, now, decision.moderated || spam ? messageId : 0);
      logIp(ctx, actor, "conversation_message", { type: "conversation_message", id: messageId });
      publishEvent(ctx, {
        type: "conversation.participants_added",
        targetType: "conversation",
        targetId: conversationId,
        payload: { userIds: ids, actorId: starter.userId },
      });
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
      message_count: content.moderated || spam ? 0 : 1,
      participant_count: participantIds.length,
      is_locked: 0,
      last_read_message_id: messageId,
    };
    const messageState = content.moderated || spam ? "moderated" : "visible";
    return {
      conversation: {
        ...summary(row, user),
        participants: participantIds.map((id) => ({ user: user(id), state: "active" as const })),
        ...viewerAbilities(permissions, row, starter.userId),
      },
      message: newMessage(
        messageId,
        conversationId,
        user,
        starter.userId,
        now,
        html,
        messageState,
        loadAttachments(ctx, "conversation_message", [messageId]),
        {
          canEdit: mayEdit(permissions, row, {
            user_id: starter.userId,
            state: messageState,
            created_at: now,
          }),
          canDelete: mayDelete(
            permissions,
            row,
            { id: messageId, user_id: starter.userId, state: messageState },
            messageId,
          ),
          canReport: permissions.can("report.create"),
        },
      ),
    };
  });
});

export const conversationsReplyOp = implement(conversationsReply, (ctx, actor, input) => {
  const user = requireAuthenticated(actor);
  const before = activeConversation(ctx, actor, input.conversationId);
  const permissions = permissionsOf(ctx, actor);
  requirePermission(ctx, actor, "conversation.reply");
  if (before.is_locked === 1) requirePermission(ctx, actor, "conversation.moderate");
  requireTermsAccepted(ctx, actor);
  requireAttach(ctx, actor, input.attachmentIds);
  return withSpamCheck(ctx, actor, input.body, "message", (spam) => {
    const content = prepareModeratedContent(ctx, actor, input.body, false);
    const refs = renderModeratedContent(ctx, actor, content, LINK_HASHTAGS);
    const html = refs.html;
    const now = ctx.now();
    const messageId = writeTx(ctx, () => {
      const row = activeConversation(ctx, actor, input.conversationId);
      if (row.is_locked === 1)
        requirePermission(ctx, currentActor(ctx, actor), "conversation.moderate");
      const decision = prepareModeratedContent(ctx, actor, input.body, false);
      if (decision.source !== content.source || decision.moderated !== content.moderated)
        throw new ConflictError("Moderation rules changed; retry.");
      requireWriteRoom(ctx, actor, "message", decision.floodSeconds);
      const id = Number(
        prepared(ctx, "conversations.insertMessage", () =>
          ctx.sqlite.prepare(
            "INSERT INTO conversation_messages (conversation_id, user_id, state, created_at, body_source, body_html) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
          ),
        ).run(
          input.conversationId,
          user.userId,
          decision.moderated || spam ? "moderated" : "visible",
          now,
          refs.source,
          html,
        ).lastInsertRowid,
      );
      storeContentReferences(ctx, "conversation_message", id, refs);
      storeSpoilers(ctx, "conversation_message", id, refs.spoilers);
      setAttachments(ctx, user.userId, "conversation_message", id, input.attachmentIds ?? []);
      validateEmbeddedAttachments(ctx, "conversation_message", id, html);
      logIp(ctx, actor, "conversation_message", { type: "conversation_message", id });
      if (!decision.moderated && !spam) {
        const restored = prepared(ctx, "conversations.restoreLeavers", () =>
          ctx.sqlite.prepare(restoreLeaversSql),
        ).run(now, input.conversationId).changes;
        prepared(ctx, "conversations.updateLastMessage", () =>
          ctx.sqlite.prepare(
            "UPDATE conversations SET last_message_at = ?1, last_message_id = ?2, last_message_user_id = ?3, message_count = message_count + 1, participant_count = participant_count + ?5 WHERE id = ?4",
          ),
        ).run(now, id, user.userId, input.conversationId, restored);
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
      }
      publishEvent(ctx, {
        type: "content.created",
        targetType: "conversation_message",
        targetId: id,
        payload: { conversationId: input.conversationId },
      });
      return id;
    });
    const author = loadUserSummaries(ctx, [user.userId]);
    const messageState = content.moderated || spam ? "moderated" : "visible";
    return newMessage(
      messageId,
      input.conversationId,
      author,
      user.userId,
      now,
      html,
      messageState,
      loadAttachments(ctx, "conversation_message", [messageId]),
      // A reply is never the first message.
      {
        canEdit: mayEdit(permissions, before, {
          user_id: user.userId,
          state: messageState,
          created_at: now,
        }),
        canDelete: mayDelete(
          permissions,
          before,
          { id: messageId, user_id: user.userId, state: messageState },
          null,
        ),
        canReport: permissions.can("report.create"),
      },
    );
  });
});

export const conversationsListMessagesOp = implement(
  conversationsListMessages,
  (ctx, actor, input) => {
    const conversation = activeConversation(ctx, actor, input.conversationId);
    const polling = input.cursor === undefined && input.afterMessageId !== undefined;
    const newest = input.order === "newest" && !polling;
    const id = input.cursor
      ? decodeCursor(input.cursor, z.tuple([z.number().int().nonnegative()]))[0]
      : polling
        ? input.afterMessageId!
        : newest
          ? Number.MAX_SAFE_INTEGER
          : 0;
    const rows = prepared(
      ctx,
      newest ? "conversations.messagesNewest" : "conversations.messages",
      () =>
        ctx.sqlite.prepare<MessageRow, [number, number, number, number, number]>(
          newest ? visibleMessagesNewestSql : visibleMessagesSql,
        ),
    ).all(
      input.conversationId,
      id,
      input.limit + 1,
      actorUserId(actor) ?? 0,
      Number(can(ctx, actor, "conversation.viewHidden")),
    );
    const page = rows.slice(0, input.limit);
    const last = page.at(-1);
    return {
      items: messages(ctx, actor, conversation, page),
      nextCursor: rows.length > input.limit && last ? encodeCursor([last.id]) : null,
    };
  },
);

// The messages of a conversation the viewer may see, as `visibleMessagesSql` filters them (?3 the
// viewer, ?4 `conversation.viewHidden`): how many are newer than one message (one range of
// `conversation_messages_conv`), the id of the one `?5` places above it (nearest first), which
// closes the page before that message's page, and the first unread and the newest message.
const seenMessage = "(state = 'visible' OR (state = 'moderated' AND user_id = ?3) OR ?4 = 1)";
export const locateMessageSql = {
  above: `SELECT count(*) AS n FROM conversation_messages WHERE conversation_id = ?1 AND id > ?2 AND ${seenMessage}`,
  nth: `SELECT id FROM conversation_messages WHERE conversation_id = ?1 AND id > ?2 AND ${seenMessage} ORDER BY id LIMIT 1 OFFSET ?5`,
  firstAfter: `SELECT id FROM conversation_messages WHERE conversation_id = ?1 AND id > ?2 AND ${seenMessage} ORDER BY id LIMIT 1`,
  newest: `SELECT id FROM conversation_messages WHERE conversation_id = ?1 AND id < ?2 AND ${seenMessage} ORDER BY id DESC LIMIT 1`,
};

// Where a message the viewer may see is: the `newest`-order cursor of the page of `limit`
// messages that holds it (null for the newest page).
function messageLocation(
  ctx: Ctx,
  actor: Actor,
  conversationId: number,
  messageId: number,
  limit: number,
) {
  const params: [number, number, number, number] = [
    conversationId,
    messageId,
    actorUserId(actor) ?? 0,
    Number(can(ctx, actor, "conversation.viewHidden")),
  ];
  const above = prepared(ctx, "conversations.locateAbove", () =>
    ctx.sqlite.prepare<{ n: number }, [number, number, number, number]>(locateMessageSql.above),
  ).get(...params)!.n;
  const closing =
    above < limit
      ? null
      : prepared(ctx, "conversations.locateNth", () =>
          ctx.sqlite.prepare<{ id: number }, [number, number, number, number, number]>(
            locateMessageSql.nth,
          ),
        ).get(...params, above % limit);
  return { conversationId, messageId, cursor: closing ? encodeCursor([closing.id]) : null };
}

export const conversationsLocateMessageOp = implement(
  conversationsLocateMessage,
  (ctx, actor, input) => {
    // The caller first, before the input is read: a guest is refused whatever was sent.
    requireAuthenticated(actor);
    const { message } = visibleTarget(ctx, actor, input.messageId);
    return messageLocation(ctx, actor, message.conversation_id, message.id, input.limit);
  },
);

export const conversationsLocateUnreadOp = implement(
  conversationsLocateUnread,
  (ctx, actor, input) => {
    requireAuthenticated(actor);
    const conversation = activeConversation(ctx, actor, input.conversationId);
    const params: [number, number, number, number] = [
      conversation.id,
      conversation.last_read_message_id,
      actorUserId(actor) ?? 0,
      Number(can(ctx, actor, "conversation.viewHidden")),
    ];
    const target =
      prepared(ctx, "conversations.firstUnread", () =>
        ctx.sqlite.prepare<{ id: number }, [number, number, number, number]>(
          locateMessageSql.firstAfter,
        ),
      ).get(...params) ??
      prepared(ctx, "conversations.newestSeen", () =>
        ctx.sqlite.prepare<{ id: number }, [number, number, number, number]>(
          locateMessageSql.newest,
        ),
      ).get(conversation.id, Number.MAX_SAFE_INTEGER, params[2], params[3]);
    // None the viewer may see: a conversation whose only message is held for approval (or
    // deleted) is still listed for its recipients, and has no place to open at.
    if (!target) throw new NotFoundError();
    return messageLocation(ctx, actor, conversation.id, target.id, input.limit);
  },
);

/** Marks the member's unread alerts about a conversation read and lowers their counter by them. */
function clearAlerts(ctx: Ctx, conversationId: number, userId: number): void {
  const now = ctx.now();
  const cleared =
    prepared(ctx, "conversations.clearNotices", () =>
      ctx.sqlite.prepare(clearConversationNoticesSql),
    ).run(now, conversationId, userId).changes +
    prepared(ctx, "conversations.clearMessageNotices", () =>
      ctx.sqlite.prepare(clearMessageNoticesSql),
    ).run(now, conversationId, userId).changes;
  if (cleared)
    prepared(ctx, "conversations.countDownNotices", () =>
      ctx.sqlite.prepare(
        "UPDATE users SET unread_notification_count = max(0, unread_notification_count - ?1) WHERE id = ?2",
      ),
    ).run(cleared, userId);
}

export const conversationsMarkReadOp = implement(
  conversationsMarkRead,
  (ctx, actor, input) => {
    const user = requireAuthenticated(actor);
    writeTx(ctx, () => {
      const row = activeConversation(ctx, actor, input.conversationId);
      prepared(ctx, "conversations.updateReadState", () =>
        ctx.sqlite.prepare(
          "UPDATE conversation_participants SET last_read_message_id = ?1 WHERE conversation_id = ?2 AND user_id = ?3",
        ),
      ).run(row.last_message_id, row.id, user.userId);
      clearAlerts(ctx, row.id, user.userId);
    });
    return { ok: true as const };
  },
  { public: "Only active participants can mark their own conversation read." },
);

export const markUnreadSql =
  "SELECT max(id) AS id FROM conversation_messages WHERE conversation_id = ?1 AND id < ?2 AND state = 'visible'";

export const conversationsMarkUnreadOp = implement(
  conversationsMarkUnread,
  (ctx, actor, input) => {
    const user = requireAuthenticated(actor);
    writeTx(ctx, () => {
      const row = activeConversation(ctx, actor, input.conversationId);
      // The mark goes back to the visible message before the newest one (0 when there is none),
      // so the newest message is the first unread. It never moves forward: a mark already
      // behind stays, so nothing unread becomes read.
      const before =
        prepared(ctx, "conversations.beforeNewest", () =>
          ctx.sqlite.prepare<{ id: number | null }, [number, number]>(markUnreadSql),
        ).get(row.id, row.last_message_id)?.id ?? 0;
      prepared(ctx, "conversations.markUnreadState", () =>
        ctx.sqlite.prepare(
          "UPDATE conversation_participants SET last_read_message_id = min(last_read_message_id, ?1) WHERE conversation_id = ?2 AND user_id = ?3",
        ),
      ).run(before, row.id, user.userId);
    });
    return { ok: true as const };
  },
  { public: "Only active participants can mark their own conversation unread." },
);

export const conversationsLeaveOp = implement(
  conversationsLeave,
  (ctx, actor, input) => {
    const user = requireAuthenticated(actor);
    writeTx(ctx, () => {
      activeConversation(ctx, actor, input.conversationId);
      prepared(ctx, "conversations.markLeft", () =>
        ctx.sqlite.prepare(
          "UPDATE conversation_participants SET state = ?3 WHERE conversation_id = ?1 AND user_id = ?2",
        ),
      ).run(
        input.conversationId,
        user.userId,
        input.futureMessages === "ignore" ? "left_ignored" : "left",
      );
      prepared(ctx, "conversations.decrementParticipants", () =>
        ctx.sqlite.prepare(
          "UPDATE conversations SET participant_count = participant_count - 1 WHERE id = ?1",
        ),
      ).run(input.conversationId);
      // A conversation the member left is no longer theirs to open: its alerts would link nowhere.
      clearAlerts(ctx, input.conversationId, user.userId);
    });
    return { ok: true as const };
  },
  { public: "Only active participants can leave their own conversation." },
);

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
  if (row.state === "deleted" && !can(ctx, actor, "conversation.viewHidden"))
    throw new NotFoundError();
  return { authorId: row.user_id, isVisible: row.state === "visible" };
}

export const conversationsAddParticipantsOp = implement(
  conversationsAddParticipants,
  (ctx, actor, input) => {
    const user = requireAuthenticated(actor);
    const before = activeConversation(ctx, actor, input.conversationId);
    if (before.user_id !== user.userId) throw new ForbiddenError();
    requirePermission(ctx, actor, "conversation.start");
    requireTermsAccepted(ctx, actor);
    const ids = [...new Set(input.userIds)].filter((id) => id !== user.userId);
    if (!ids.length) throw new ValidationError("At least one other person is required.");
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
      const message = `Unknown user IDs: ${missing.join(", ")}.`;
      throw new ValidationError(message, [{ path: ["userIds"], message }]);
    }
    const permissions = permissionsOf(ctx, actor);
    writeTx(ctx, () => {
      const row = activeConversation(ctx, actor, input.conversationId);
      if (row.user_id !== user.userId) throw new ForbiddenError();
      const states = new Map(
        prepared(ctx, "conversations.participantStates", () =>
          ctx.sqlite.prepare<ParticipantRow, [number, string]>(participantStatesSql),
        )
          .all(row.id, JSON.stringify(ids))
          .map((p) => [p.user_id, p.state] as const),
      );
      const added = ids.filter((id) => states.get(id) !== "active");
      if (!added.length) return;
      requireReceivers(ctx, actor, added);
      if (ignoredByRecipient(ctx, actor, user.userId, added)) throw new ForbiddenError();
      const maxRecipients = permissions.value("conversation.maxRecipients");
      if (maxRecipients !== -1 && row.participant_count - 1 + added.length > maxRecipients) {
        const message = `You can add at most ${maxRecipients} recipients.`;
        throw new ValidationError(message, [{ path: ["userIds"], message }]);
      }
      const reactivate = prepared(ctx, "conversations.reactivateParticipant", () =>
        ctx.sqlite.prepare(reactivateParticipantSql),
      );
      const insert = prepared(ctx, "conversations.addParticipant", () =>
        ctx.sqlite.prepare(addParticipantSql),
      );
      // A person added is unread exactly when there is a message for them to see; while the
      // conversation's only message is held for approval, creation gives recipients the same.
      const unreadFor = row.message_count > 0 ? 0 : row.last_message_id;
      for (const id of added) {
        if (states.has(id)) reactivate.run(row.last_message_at, row.id, id);
        else insert.run(row.id, id, ctx.now(), row.last_message_at, unreadFor);
      }
      prepared(ctx, "conversations.incrementParticipants", () =>
        ctx.sqlite.prepare(incrementParticipantsSql),
      ).run(added.length, row.id);
      publishEvent(ctx, {
        type: "conversation.participants_added",
        targetType: "conversation",
        targetId: row.id,
        payload: { userIds: added, actorId: user.userId },
      });
    });
    return fullConversation(ctx, actor, activeConversation(ctx, actor, input.conversationId));
  },
);

export const conversationsRenameOp = implement(conversationsRename, (ctx, actor, input) => {
  const user = requireAuthenticated(actor);
  const before = activeConversation(ctx, actor, input.conversationId);
  if (before.user_id !== user.userId) throw new ForbiddenError();
  requirePermission(ctx, actor, "conversation.reply");
  // The title reaches every participant: it is member text like a message.
  requireTermsAccepted(ctx, actor);
  writeTx(ctx, () => {
    const row = activeConversation(ctx, actor, input.conversationId);
    if (row.user_id !== user.userId) throw new ForbiddenError();
    prepared(ctx, "conversations.rename", () =>
      ctx.sqlite.prepare("UPDATE conversations SET title = ?1 WHERE id = ?2"),
    ).run(input.title, row.id);
  });
  return fullConversation(ctx, actor, activeConversation(ctx, actor, input.conversationId));
});

export const conversationsSetLockedOp = implement(conversationsSetLocked, (ctx, actor, input) => {
  const user = requireAuthenticated(actor);
  const before = activeConversation(ctx, actor, input.conversationId);
  if (before.user_id !== user.userId) requirePermission(ctx, actor, "conversation.moderate");
  writeTx(ctx, () => {
    const row = activeConversation(ctx, actor, input.conversationId);
    if (row.user_id !== user.userId)
      requirePermission(ctx, currentActor(ctx, actor), "conversation.moderate");
    if ((row.is_locked === 1) === input.locked) return;
    prepared(ctx, "conversations.setLocked", () =>
      ctx.sqlite.prepare("UPDATE conversations SET is_locked = ?1 WHERE id = ?2"),
    ).run(Number(input.locked), row.id);
    if (row.user_id !== user.userId)
      appendModeratorLog(
        ctx,
        actor,
        input.locked ? "conversation.lock" : "conversation.unlock",
        "conversation",
        row.id,
      );
  });
  return fullConversation(ctx, actor, activeConversation(ctx, actor, input.conversationId));
});

interface TargetMessage {
  id: number;
  conversation_id: number;
  user_id: number;
  state: "visible" | "moderated" | "deleted";
  created_at: number;
}
const targetMessageSql =
  "SELECT id, conversation_id, user_id, state, created_at FROM conversation_messages WHERE id = ?1";

/** A message of a conversation the viewer takes part in, as far as the viewer may see it. */
function visibleTarget(ctx: Ctx, actor: Actor, messageId: number) {
  const user = requireAuthenticated(actor);
  const message = prepared(ctx, "conversations.targetMessage", () =>
    ctx.sqlite.prepare<TargetMessage, [number]>(targetMessageSql),
  ).get(messageId);
  if (!message) throw new NotFoundError();
  const conversation = activeConversation(ctx, actor, message.conversation_id);
  if (!seesMessage(permissionsOf(ctx, actor), message, user.userId)) throw new NotFoundError();
  return { message, conversation };
}

export const conversationsUpdateMessageOp = implement(
  conversationsUpdateMessage,
  (ctx, actor, input) => {
    const user = requireAuthenticated(actor);
    const { message, conversation } = visibleTarget(ctx, actor, input.messageId);
    if (message.state === "deleted") throw new ConflictError("The message is deleted.");
    if (!mayEdit(permissionsOf(ctx, actor), conversation, message)) throw new ForbiddenError();
    requireTermsAccepted(ctx, actor);
    requireAttach(ctx, actor, input.attachmentIds, message.id);
    const content = prepareModeratedContent(ctx, actor, input.body, false);
    const refs = renderModeratedContent(ctx, actor, content, {
      ...LINK_HASHTAGS,
      edit: {
        contentType: "conversation_message",
        contentId: message.id,
        authorId: message.user_id,
      },
    });
    const html = refs.html;
    writeTx(ctx, () => {
      const current = prepared(ctx, "conversations.targetMessage", () =>
        ctx.sqlite.prepare<TargetMessage, [number]>(targetMessageSql),
      ).get(message.id);
      const row = activeConversation(ctx, actor, message.conversation_id);
      if (!current) throw new NotFoundError();
      if (current.state === "deleted") throw new ConflictError("The message is deleted.");
      const fresh = currentActor(ctx, actor);
      if (!mayEdit(permissionsOf(ctx, fresh), row, current)) throw new ForbiddenError();
      const decision = prepareModeratedContent(ctx, actor, input.body, false);
      if (decision.source !== content.source)
        throw new ConflictError("Moderation rules changed; retry.");
      setAttachments(ctx, user.userId, "conversation_message", message.id, input.attachmentIds);
      validateEmbeddedAttachments(ctx, "conversation_message", message.id, html);
      prepared(ctx, "conversations.updateMessage", () =>
        ctx.sqlite.prepare(
          "UPDATE conversation_messages SET body_source = ?1, body_html = ?2, edited_at = CASE WHEN ?5 = 1 THEN edited_at ELSE ?3 END WHERE id = ?4",
        ),
      ).run(
        refs.source,
        html,
        ctx.now(),
        message.id,
        Number(can(ctx, fresh, "content.editSilently")),
      );
      const { newlyMentioned } = storeContentReferences(
        ctx,
        "conversation_message",
        message.id,
        refs,
      );
      storeSpoilers(ctx, "conversation_message", message.id, refs.spoilers);
      if (decision.moderated)
        moderateEditedContent(ctx, actor, { type: "conversation_message", id: message.id });
      publishEvent(ctx, {
        type: "content.edited",
        targetType: "conversation_message",
        targetId: message.id,
        payload: { newlyMentioned },
      });
      if (message.user_id !== user.userId && can(ctx, fresh, "conversation.moderate"))
        appendModeratorLog(
          ctx,
          actor,
          "conversation_message.edit",
          "conversation_message",
          message.id,
        );
    });
    const row = prepared(ctx, "conversations.message", () =>
      ctx.sqlite.prepare<MessageRow, [number]>(messageSql),
    ).get(message.id)!;
    return messages(ctx, actor, activeConversation(ctx, actor, message.conversation_id), [row])[0]!;
  },
);

export const conversationsGetMessageOp = implement(conversationsGetMessage, (ctx, actor, input) => {
  const { message, conversation } = visibleTarget(ctx, actor, input.messageId);
  // The source is for editors: whoever may not edit the message finds nothing.
  if (!mayEdit(permissionsOf(ctx, actor), conversation, message)) throw new NotFoundError();
  const row = prepared(ctx, "conversations.message", () =>
    ctx.sqlite.prepare<MessageRow, [number]>(messageSql),
  ).get(message.id)!;
  const { body_source } = prepared(ctx, "conversations.messageSource", () =>
    ctx.sqlite.prepare<{ body_source: string }, [number]>(
      "SELECT body_source FROM conversation_messages WHERE id = ?1",
    ),
  ).get(message.id)!;
  return { ...messages(ctx, actor, conversation, [row])[0]!, bodySource: body_source };
});

export const conversationsDeleteMessageOp = implement(
  conversationsDeleteMessage,
  (ctx, actor, input) => {
    const user = requireAuthenticated(actor);
    const { message, conversation } = visibleTarget(ctx, actor, input.messageId);
    if (message.state === "deleted") throw new ConflictError("The message is deleted.");
    const first = firstMessageId(ctx, message.conversation_id);
    if (message.id === first) throw new ValidationError("Delete the conversation instead.");
    if (!mayDelete(permissionsOf(ctx, actor), conversation, message, first))
      throw new ForbiddenError();
    writeTx(ctx, () => {
      const current = prepared(ctx, "conversations.targetMessage", () =>
        ctx.sqlite.prepare<TargetMessage, [number]>(targetMessageSql),
      ).get(message.id);
      const row = activeConversation(ctx, actor, message.conversation_id);
      if (!current) throw new NotFoundError();
      if (current.state === "deleted") throw new ConflictError("The message is deleted.");
      const fresh = currentActor(ctx, actor);
      if (!mayDelete(permissionsOf(ctx, fresh), row, current, first)) throw new ForbiddenError();
      deleteMessageState(ctx, current);
      publishEvent(ctx, {
        type: "content.deleted",
        targetType: "conversation_message",
        targetId: current.id,
        payload: {
          previousState: current.state,
          state: "deleted",
          ...noticeForOther(actor, current.user_id, { notify: true, reason: "" }),
        },
      });
      if (current.user_id !== user.userId && can(ctx, fresh, "conversation.moderate"))
        appendModeratorLog(ctx, actor, "content.deleted", "conversation_message", current.id);
    });
    return { ok: true as const };
  },
);

/** The conversation counters of a message leaving `visible`, as the moderation path keeps them. */
function deleteMessageState(ctx: Ctx, message: TargetMessage) {
  prepared(ctx, "conversations.deleteMessage", () =>
    ctx.sqlite.prepare("UPDATE conversation_messages SET state = 'deleted' WHERE id = ?1"),
  ).run(message.id);
  if (message.state !== "visible") return;
  prepared(ctx, "conversations.decrementMessages", () =>
    ctx.sqlite.prepare("UPDATE conversations SET message_count = message_count - 1 WHERE id = ?1"),
  ).run(message.conversation_id);
  const last = prepared(ctx, "conversations.lastVisibleMessage", () =>
    ctx.sqlite.prepare<{ id: number; user_id: number; created_at: number }, [number]>(
      "SELECT id, user_id, created_at FROM conversation_messages WHERE conversation_id = ?1 AND state = 'visible' ORDER BY id DESC LIMIT 1",
    ),
  ).get(message.conversation_id);
  if (!last) return;
  prepared(ctx, "conversations.setLastMessage", () =>
    ctx.sqlite.prepare(
      "UPDATE conversations SET last_message_id = ?1, last_message_user_id = ?2, last_message_at = ?3 WHERE id = ?4",
    ),
  ).run(last.id, last.user_id, last.created_at, message.conversation_id);
  prepared(ctx, "conversations.setParticipantsLast", () =>
    ctx.sqlite.prepare(
      "UPDATE conversation_participants SET last_message_at = ?1 WHERE conversation_id = ?2",
    ),
  ).run(last.created_at, message.conversation_id);
}

export const operations = [
  conversationsSetLockedOp,
  conversationsUpdateMessageOp,
  conversationsGetMessageOp,
  conversationsDeleteMessageOp,
  conversationsListOp,
  conversationsGetOp,
  conversationsCreateOp,
  conversationsReplyOp,
  conversationsListMessagesOp,
  conversationsLocateMessageOp,
  conversationsLocateUnreadOp,
  conversationsMarkReadOp,
  conversationsMarkUnreadOp,
  conversationsLeaveOp,
  conversationsAddParticipantsOp,
  conversationsRenameOp,
];
