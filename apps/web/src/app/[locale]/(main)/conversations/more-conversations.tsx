"use server";

import { conversationsList } from "@sermo/core/contracts";
import { ConversationRow } from "@/app/[locale]/(main)/conversations/conversation-row";
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
      <ConversationRow
        key={conversation.id}
        conversation={conversation}
        member={member(conversation.lastMessage.user.id)}
      />
    )),
  };
}
