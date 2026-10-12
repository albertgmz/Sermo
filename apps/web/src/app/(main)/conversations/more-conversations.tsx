"use server";

import { conversationsList } from "@sermo/core/contracts";
import { ConversationLink } from "@/app/(main)/conversations/conversation-nav";
import { ConversationPreview } from "@/components/forum/conversation-preview";
import { call } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";
import { membersFor } from "@/lib/sermo/members";

// The rows of one more page of the list, drawn on the server so the avatars keep reading the
// LITE cookie. Called when the visitor asks for older conversations.
export async function moreConversations(cursor: string) {
  // A stale cursor or a dead session is an empty page, not a broken list.
  const { items, nextCursor } = await call(conversationsList, { cursor }).catch(
    (error) => {
      if (!(error instanceof SermoError)) throw error;
      return { items: [], nextCursor: null };
    },
  );
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
