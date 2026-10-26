import * as z from "zod";
import { defineContract } from "../operation";
import { Attachment, AttachmentIds } from "./attachments";
import {
  Body,
  ContentAuthor,
  ContentState,
  Id,
  Limit,
  moderationNotice,
  Ok,
  Page,
  PostDeletion,
  pageInput,
  ReactionSummary,
  Timestamp,
  Title,
  UserSummary,
} from "./common";

export const ConversationSummary = z
  .object({
    id: Id,
    title: z.string(),
    starter: UserSummary,
    createdAt: Timestamp,
    lastMessage: z.object({ messageId: Id, sentAt: Timestamp, user: ContentAuthor }),
    messageCount: z.number().int().nonnegative(),
    participantCount: z.number().int().nonnegative(),
    /** True when the newest message is newer than what the viewer has read. */
    isUnread: z.boolean(),
  })
  .meta({ id: "ConversationSummary" });

export const Conversation = ConversationSummary.extend({
  /** Who left shows as `left` whether or not they ignore future messages. */
  participants: z.array(z.object({ user: UserSummary, state: z.enum(["active", "left"]) })),
  canReply: z.boolean(),
  /** True when the viewer may add people: the starter, holding `conversation.start`, with room under `conversation.maxRecipients`. */
  canInvite: z.boolean(),
  /** True when the viewer may rename the conversation: its starter, holding `conversation.reply`. */
  canRename: z.boolean(),
  /** Locked: nobody replies except holders of `conversation.moderate`. */
  isLocked: z.boolean(),
  /** The viewer may lock or unlock it: its starter, or a holder of `conversation.moderate`. */
  canLock: z.boolean(),
}).meta({ id: "Conversation" });

export const Message = z
  .object({
    id: Id,
    conversationId: Id,
    author: ContentAuthor,
    state: ContentState,
    createdAt: Timestamp,
    editedAt: Timestamp.nullable(),
    bodyHtml: z.string(),
    attachmentCount: z.number().int().nonnegative(),
    attachments: z.array(Attachment),
    reactions: ReactionSummary,
    /** Its author holding `conversation.editOwn`, or a holder of `conversation.moderate`; not while locked unless the viewer moderates. */
    canEdit: z.boolean(),
    /** As canEdit with `conversation.deleteOwn`; never the conversation's first message. */
    canDelete: z.boolean(),
    /** `conversations.hardDeleteMessage` would accept it: `conversation.hardDelete`, never the first message. */
    canHardDelete: z.boolean(),
    /** The viewer may report it (reports.create would accept it). */
    canReport: z.boolean(),
    /**
     * Who hid a deleted message and why, for viewers who may see deleted messages
     * (conversation.viewHidden); null for everyone else and for a message that is not deleted.
     */
    deletion: PostDeletion.nullable(),
  })
  .meta({ id: "Message" });

export const MessageDetail = Message.extend({ bodySource: z.string() }).meta({
  id: "MessageDetail",
});

export const conversationsList = defineContract({
  name: "conversations.list",
  summary:
    "The viewer's active conversations, most recent activity first. `page` (from 1; a " +
    "`cursor` takes precedence over it) is the page of `limit` conversations at that place in " +
    "the list; with `page`, `total` is how many the list holds (`ceil(total / limit)` pages), " +
    "null without it.",
  kind: "read",
  input: z.object({ page: z.number().int().min(1).optional(), ...pageInput }),
  output: Page(ConversationSummary).extend({ total: z.number().int().nonnegative().nullable() }),
});

export const conversationsGet = defineContract({
  name: "conversations.get",
  summary: "One conversation the viewer actively participates in.",
  kind: "read",
  input: z.object({ conversationId: Id }),
  output: Conversation,
});

export const conversationsCreate = defineContract({
  name: "conversations.create",
  summary:
    "Start a private conversation with one or more users. Each recipient must hold " +
    "`conversation.receive`; a block between the starter and a recipient, whoever made it, " +
    "refuses unless the starter holds `conversation.alwaysInvite`. Attaching files needs " +
    "`conversation.attach`.",
  kind: "write",
  input: z.object({
    title: Title,
    recipientIds: z.array(Id).min(1).max(50),
    body: Body,
    attachmentIds: AttachmentIds,
  }),
  output: z.object({ conversation: Conversation, message: Message }),
});

export const conversationsReply = defineContract({
  name: "conversations.reply",
  summary: "Add a message to a conversation. Active participants only.",
  kind: "write",
  input: z.object({ conversationId: Id, body: Body, attachmentIds: AttachmentIds }),
  output: Message,
});

export const conversationsListMessages = defineContract({
  name: "conversations.listMessages",
  summary:
    "Messages of a conversation. `order` `oldest` (the default) lists from the first message " +
    "forwards; `newest` lists from the latest message backwards, so a client can open a long " +
    "conversation at its end, and its `nextCursor` continues towards older messages. A cursor " +
    "belongs to the order it was issued for; one sent with the other order simply continues " +
    "from its message in that order's direction. `afterMessageId` (the newest message the " +
    "client holds) starts the walk at the messages above that id, oldest first, whatever the " +
    "`order`, so a client can poll for replies: the answer is empty when there is nothing " +
    "new. A `cursor` takes precedence over it. A message approved after newer ones were " +
    "posted keeps its old id and is not returned this way, and edits or removals of messages " +
    "the client already holds are not shown by it: they need a reload. `page` (from 1, the " +
    "oldest messages first, as a thread's pages; a `cursor` or `afterMessageId` takes " +
    "precedence over it, and it over `order`) is the page of `limit` messages at that place " +
    "among the ones the viewer may see; with it, `total` is how many messages the viewer may " +
    "see (`ceil(total / limit)` pages), null without it (a poll costs no count).",
  kind: "read",
  input: z.object({
    conversationId: Id,
    order: z.enum(["oldest", "newest"]).default("oldest"),
    afterMessageId: Id.optional(),
    page: z.number().int().min(1).optional(),
    ...pageInput,
  }),
  output: Page(Message).extend({ total: z.number().int().nonnegative().nullable() }),
});

/**
 * Where a message is: the `conversations.listMessages` page that holds it, as a cursor (order
 * `newest`) and as a page number (`page`, counted from the oldest message).
 */
export const MessageLocation = z
  .object({
    conversationId: Id,
    messageId: Id,
    cursor: z.string().nullable(),
    page: z.number().int().min(1),
  })
  .meta({ id: "MessageLocation" });

export const conversationsLocateMessage = defineContract({
  name: "conversations.locateMessage",
  summary:
    "Where a message is: its conversation, and the `conversations.listMessages` cursor (order " +
    "`newest`) that opens the page of `limit` messages holding it, the pages counted from the " +
    "newest message the viewer may see (null for the first page), and the number of that page " +
    "of `limit` messages counted from the oldest one (`page`). Active participants only; " +
    "anyone else, or a message the viewer may not see, gets not found.",
  kind: "read",
  input: z.object({ messageId: Id, limit: Limit }),
  output: MessageLocation,
});

export const conversationsLocateUnread = defineContract({
  name: "conversations.locateUnread",
  summary:
    "Where the viewer's first unread message of a conversation is (the oldest message after the " +
    "last one they read), or the newest message when they have read everything, as " +
    "`conversations.locateMessage` gives it. Reading it marks nothing read. Active participants " +
    "only.",
  kind: "read",
  input: z.object({ conversationId: Id, limit: Limit }),
  output: MessageLocation,
});

export const conversationsMarkRead = defineContract({
  name: "conversations.markRead",
  summary: "Mark the conversation read up to its newest message.",
  kind: "write",
  input: z.object({ conversationId: Id }),
  output: Ok,
});

export const conversationsMarkUnread = defineContract({
  name: "conversations.markUnread",
  summary:
    "Mark the conversation unread again: the viewer's read mark goes back to before its newest " +
    "visible message, so the conversation counts as unread and opens there. Active participants " +
    "only.",
  kind: "write",
  input: z.object({ conversationId: Id }),
  output: Ok,
});

export const conversationsLeave = defineContract({
  name: "conversations.leave",
  summary:
    "Leave a conversation. It disappears from the viewer's list. With `futureMessages` " +
    "`accept` (the default) a new reply brings it back, with the messages sent meanwhile unread; " +
    "with `ignore` it stays gone until someone adds the viewer again.",
  kind: "write",
  input: z.object({
    conversationId: Id,
    futureMessages: z.enum(["accept", "ignore"]).default("accept"),
  }),
  output: Ok,
});

export const conversationsAddParticipants = defineContract({
  name: "conversations.addParticipants",
  summary:
    "Add people to a conversation. Only its starter, while an active participant and holding " +
    "`conversation.start`. The rules of starting a conversation apply to the people added " +
    "(existing members holding `conversation.receive`, none in a block with the starter unless " +
    "the starter holds `conversation.alwaysInvite`), and `conversation.maxRecipients` limits " +
    "the other active participants after the addition. Someone already active is skipped; " +
    "someone who left becomes active again. A new participant sees the conversation as unread, " +
    "and each person added is told so.",
  kind: "write",
  input: z.object({ conversationId: Id, userIds: z.array(Id).min(1).max(50) }),
  output: Conversation,
});

export const conversationsRename = defineContract({
  name: "conversations.rename",
  summary: "Change a conversation's title. Only its starter, while an active participant.",
  kind: "write",
  input: z.object({ conversationId: Id, title: Title }),
  output: Conversation,
});

export const conversationsSetLocked = defineContract({
  name: "conversations.setLocked",
  summary:
    "Lock or unlock a conversation. Its starter while an active participant, or a holder of " +
    "`conversation.moderate` taking part in it. While locked only holders of " +
    "`conversation.moderate` can reply.",
  kind: "write",
  input: z.object({ conversationId: Id, locked: z.boolean() }),
  output: Conversation,
});

export const conversationsUpdateMessage = defineContract({
  name: "conversations.updateMessage",
  summary:
    "Edit a message's body (and, when `attachmentIds` is sent, its attachments). Its author " +
    "holding `conversation.editOwn` while an active participant, or a holder of " +
    "`conversation.moderate` taking part in the conversation. Sets `editedAt`.",
  kind: "write",
  input: z.object({ messageId: Id, body: Body, attachmentIds: AttachmentIds }),
  output: Message,
});

export const conversationsGetMessage = defineContract({
  name: "conversations.getMessage",
  summary:
    "One message with its source, for editing. Only for viewers who may edit it (`canEdit`); " +
    "anyone else gets not found.",
  kind: "read",
  input: z.object({ messageId: Id }),
  output: MessageDetail,
});

export const conversationsQuoteMessage = defineContract({
  name: "conversations.quoteMessage",
  summary:
    "A visible message's author and source, to quote it in a reply. Active participants only; " +
    "anyone else, or a message that is not visible, gets not found.",
  kind: "read",
  input: z.object({ messageId: Id }),
  output: z
    .object({ messageId: Id, author: ContentAuthor, bodySource: z.string() })
    .meta({ id: "MessageQuote" }),
});

export const conversationsDeleteMessage = defineContract({
  name: "conversations.deleteMessage",
  summary:
    "Soft-delete a message (state `deleted`). Its author holding `conversation.deleteOwn` while " +
    "an active participant, or a holder of `conversation.moderate` taking part in the " +
    "conversation. The first message cannot be deleted on its own. A reason may be given.",
  kind: "write",
  input: z.object({ ...moderationNotice, messageId: Id }),
  output: Ok,
});

export const conversationsHardDeleteMessage = defineContract({
  name: "conversations.hardDeleteMessage",
  summary:
    "Delete a message for good, in whatever state it is, with its reactions, attachments, " +
    "alerts and reports. Requires `conversation.hardDelete` (administrators by default) and a " +
    "seat in the conversation with the right to see the message. The first message cannot be " +
    "deleted on its own. Logged as `conversation_message.hardDelete` with the conversation and " +
    "the author.",
  kind: "write",
  input: z.object({ messageId: Id, reason: moderationNotice.reason }),
  output: Ok,
});
