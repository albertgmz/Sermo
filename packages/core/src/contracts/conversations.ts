import * as z from "zod";
import { PARTICIPANT_STATES } from "../db/schema";
import { defineContract } from "../operation";
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
}).meta({ id: "Conversation" });

export const Message = z
  .object({
    id: Id,
    conversationId: Id,
    author: UserSummary,
    state: ContentState,
    createdAt: Timestamp,
    bodyHtml: z.string(),
    reactions: ReactionSummary,
  })
  .meta({ id: "Message" });

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
  }),
  output: z.object({ conversation: Conversation, message: Message }),
});

export const conversationsReply = defineContract({
  name: "conversations.reply",
  summary: "Add a message to a conversation. Active participants only.",
  kind: "write",
  input: z.object({ conversationId: Id, body: Body }),
  output: Message,
});

export const conversationsListMessages = defineContract({
  name: "conversations.listMessages",
  summary: "Messages of a conversation, oldest first.",
  kind: "read",
  input: z.object({ conversationId: Id, ...pageInput }),
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
