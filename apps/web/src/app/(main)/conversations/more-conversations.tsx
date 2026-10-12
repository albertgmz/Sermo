"use server";

import { conversationsList } from "@sermo/core/contracts";
import { ConversationLink } from "@/app/(main)/conversations/conversation-nav";
import { ConversationPreview } from "@/components/forum/conversation-preview";
import { read } from "@/lib/sermo/client";
import { membersFor } from "@/lib/sermo/members";

// The rows of one more page of the list, drawn on the server so the avatars keep reading the
// LITE cookie. Called when the visitor asks for older conversations.
export async function moreConversations(cursor: string) {
  const { items, nextCursor } = await read(conversationsList, { cursor });
  const member = await membersFor(items.map((c) => c.lastMessage.user));
  return {
    nextCursor,
    rows: items.map((conversation) => (
      <li key={conversation.id}>
        <ConversationLink id={conversation.id}>
          <ConversationPreview
            linked
            conversation={conversation}
            member={member(conversation.lastMessage.user.id)}
          />
        </ConversationLink>
      </li>
    )),
  };
}
