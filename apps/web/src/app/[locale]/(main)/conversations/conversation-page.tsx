import { conversationsList } from "@sermo/core/contracts";
import { ConversationRow } from "@/app/[locale]/(main)/conversations/conversation-row";
import type { ListPage } from "@/lib/list-pages";
import { read } from "@/lib/sermo/client";
import { membersFor } from "@/lib/sermo/members";

// One page of the member's conversations, drawn: the list's first page and each page the browser
// asks for.
export async function conversationsPage(
  cursor?: string,
  reader: typeof read = read,
): Promise<ListPage> {
  const { items, nextCursor } = await reader(conversationsList, { cursor });
  const member = await membersFor(items.map((c) => c.lastMessage.user));
  return {
    nextCursor,
    rows: items.map((conversation) => ({
      key: String(conversation.id),
      node: (
        <ConversationRow
          conversation={conversation}
          member={member(conversation.lastMessage.user.id)}
        />
      ),
    })),
  };
}
