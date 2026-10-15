import * as z from "zod";
import { PARTICIPANT_STATES } from "../db/schema";
import { defineContract } from "../operation";
import { Attachment, AttachmentIds } from "./attachments";
import {
  Body,
  ContentState,
  Id,
  Ok,
  Page,
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
    lastMessage: z.object({ messageId: Id, sentAt: Timestamp, user: UserSummary }),
    messageCount: z.number().int().nonnegative(),
    participantCount: z.number().int().nonnegative(),
    /** True when the newest message is newer than what the viewer has read. */
    isUnread: z.boolean(),
  })
  .meta({ id: "ConversationSummary" });

export const Conversation = ConversationSummary.extend({
  participants: z.array(z.object({ user: UserSummary, state: z.enum(PARTICIPANT_STATES) })),
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
    author: UserSummary,
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
  })
  .meta({ id: "Message" });

export const MessageDetail = Message.extend({ bodySource: z.string() }).meta({
  id: "MessageDetail",
});

export const conversationsList = defineContract({
  name: "conversations.list",
  summary: "The viewer's active conversations, most recent activity first.",
  kind: "read",
  input: z.object({ ...pageInput }),
  output: Page(ConversationSummary),
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
  summary: "Start a private conversation with one or more users.",
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
    "posted keeps its old id and is not returned this way.",
  kind: "read",
  input: z.object({
    conversationId: Id,
    order: z.enum(["oldest", "newest"]).default("oldest"),
    afterMessageId: Id.optional(),
    ...pageInput,
  }),
  output: Page(Message),
});

export const conversationsMarkRead = defineContract({
  name: "conversations.markRead",
  summary: "Mark the conversation read up to its newest message.",
  kind: "write",
  input: z.object({ conversationId: Id }),
  output: Ok,
});

export const conversationsLeave = defineContract({
  name: "conversations.leave",
  summary: "Leave a conversation. It disappears from the viewer's list for good.",
  kind: "write",
  input: z.object({ conversationId: Id }),
  output: Ok,
});

export const conversationsAddParticipants = defineContract({
  name: "conversations.addParticipants",
  summary:
    "Add people to a conversation. Only its starter, while an active participant and holding " +
    "`conversation.start`. The rules of starting a conversation apply to the people added " +
    "(existing members, none who ignore the starter), and `conversation.maxRecipients` limits " +
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

export const conversationsDeleteMessage = defineContract({
  name: "conversations.deleteMessage",
  summary:
    "Soft-delete a message (state `deleted`). Its author holding `conversation.deleteOwn` while " +
    "an active participant, or a holder of `conversation.moderate` taking part in the " +
    "conversation. The first message cannot be deleted on its own.",
  kind: "write",
  input: z.object({ messageId: Id }),
  output: Ok,
});
