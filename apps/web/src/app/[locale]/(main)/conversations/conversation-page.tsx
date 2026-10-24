import { conversationsList } from "@sermo/core/contracts";
import { ConversationRow } from "@/app/[locale]/(main)/conversations/conversation-row";
import { NumberedList } from "@/components/forum/numbered-list";
import { pagesOf } from "@/components/forum/page-window";
import type { ListRow } from "@/lib/list-pages";
import { read } from "@/lib/sermo/client";
import { membersFor } from "@/lib/sermo/members";

// Direct messages in a page of the list, as XenForo shows 40 to a page.
export const CONVERSATIONS_PER_PAGE = 40;

export type ConversationsPage = { rows: ListRow[]; total: number };

// One numbered page of the member's conversations, drawn, and how many the list holds.
export async function conversationsPage(
  page: number,
  reader: typeof read = read,
): Promise<ConversationsPage> {
  const { items, total } = await reader(conversationsList, {
    page,
    limit: CONVERSATIONS_PER_PAGE,
  });
  const member = await membersFor(items.map((c) => c.lastMessage.user));
  return {
    total: total ?? 0,
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

// The part of the list page that turns with its pages (`PageSwitch`): the pagers and the list.
export function ConversationPages({
  page,
  list,
}: {
  page: number;
  list: ConversationsPage;
}) {
  return (
    <NumberedList
      page={page}
      pages={pagesOf(list.total, CONVERSATIONS_PER_PAGE)}
      path="/conversations"
      rows={list.rows}
      className="overflow-hidden rounded-lg border bg-card"
    />
  );
}
