import {
  type conversationsGet,
  conversationsListMessages,
} from "@sermo/core/contracts";
import type * as z from "zod";
import { ConversationSync } from "@/app/[locale]/(main)/conversations/[id]/conversation-sync";
import { MessageItem } from "@/app/[locale]/(main)/conversations/[id]/message-item";
import { pollMessages } from "@/app/[locale]/(main)/conversations/poll-messages";
import { LiveTail, PendingBody } from "@/components/forum/live-tail";
import { PageNav } from "@/components/forum/page-nav";
import { pagesOf } from "@/components/forum/page-window";
import { PostFrame } from "@/components/forum/post-frame";
import { getCounters } from "@/components/layout/header-data";
import { POLL_MS } from "@/lib/poll-intervals";
import type { read } from "@/lib/sermo/client";
import { authorsFor } from "@/lib/sermo/members";
import { MESSAGES_PER_PAGE } from "@/lib/sermo/page-sizes";
import { getReactionTypes, pickerTypes } from "@/lib/sermo/reactions";
import { getMember } from "@/lib/sermo/session";

export type Conversation = z.output<typeof conversationsGet.output>;
export type MessagesRead = z.output<typeof conversationsListMessages.output>;

// What the messages of a page are drawn with: the conversation and what the viewer may do there.
export type MessagesContext = {
  conversation: Conversation;
  canReact: boolean;
  viewList: boolean;
};

// The context of a conversation's messages for the viewer, from what `getMember` says of them.
export function messagesContext(
  conversation: Conversation,
  {
    permissions,
    resolvedPermissions,
  }: Pick<
    Awaited<ReturnType<typeof getMember>>,
    "permissions" | "resolvedPermissions"
  >,
): MessagesContext {
  return {
    conversation,
    canReact:
      permissions.canReact &&
      resolvedPermissions["conversation.react"] !== false,
    viewList: resolvedPermissions["reaction.viewList"] !== false,
  };
}

// What the end of this conversation is kept under while the page is open.
export const tailKey = (conversationId: number) =>
  `conversation:${conversationId}`;

// A numbered page of a conversation's messages, page 1 its oldest ones, as XenForo numbers them.
export function readMessages(
  conversationId: number,
  page: number,
  reader: typeof read,
) {
  return reader(conversationsListMessages, { conversationId, page });
}

// How many pages the conversation has for the viewer.
export const messagePages = (list: MessagesRead) =>
  pagesOf(list.total ?? 0, MESSAGES_PER_PAGE);

// The part of the conversation page that turns with its pages (`PageSwitch`): the pager above the
// messages (from a wide screen up, as XenForo's), the messages, the pager below. The last page goes
// on while it is open: what is sent or arrives ends it. Only the last page records the
// conversation as read: the backend marks it read to its newest message, and XenForo marks read up
// to the newest message on the page viewed, so an earlier page leaves the later messages unread. A
// page loaded anew opens at its end when it is the last one, a page turned in place at its top.
export async function MessagesRegion({
  context,
  page,
  list,
  inPlace = false,
}: {
  context: MessagesContext;
  page: number;
  list: MessagesRead;
  // Drawn for `PageSwitch`.
  inPlace?: boolean;
}) {
  const { conversation, canReact, viewList } = context;
  const [{ user }, reactionTypes, { notifications }] = await Promise.all([
    getMember(),
    getReactionTypes(),
    getCounters(),
  ]);
  const messages = list.items;
  // The viewer is among the authors: the row drawn for a message they are sending is theirs.
  const author = await authorsFor([
    ...messages.map((message) => message.author),
    ...(user ? [user] : []),
  ]);
  // One signature per member on the page: under their first message.
  const seen = new Set<number>();
  const firstOfAuthor = new Set(
    messages.flatMap((message) => {
      if (seen.has(message.author.id)) return [];
      seen.add(message.author.id);
      return [message.id];
    }),
  );
  const picker = canReact ? pickerTypes(reactionTypes, null) : [];
  const newest = messages.at(-1);
  const pages = messagePages(list);
  const last = page >= pages;
  const pager = (className: string) => (
    <PageNav
      page={page}
      pages={pages}
      path={`/conversations/${conversation.id}`}
      className={className}
    />
  );
  return (
    <>
      {pager("mb-3 max-sm:hidden")}
      <ol className="divide-y divide-border overflow-hidden rounded-lg border bg-card">
        {messages.map((message) => (
          <li key={message.id}>
            <MessageItem
              message={message}
              author={author(message.author.id)}
              signed={firstOfAuthor.has(message.id)}
              viewerId={user?.id ?? null}
              picker={picker}
              reactionTypes={reactionTypes}
              viewList={viewList}
              canQuote={conversation.canReply}
            />
          </li>
        ))}
        {last && user && newest && (
          <LiveTail
            tailKey={tailKey(conversation.id)}
            drawn={{ id: newest.id, mark: newest.id }}
            as="li"
            poll={pollMessages.bind(null, conversation.id)}
            intervalMs={POLL_MS.messages}
            pendingRow={
              <PostFrame
                author={author(user.id)}
                createdAt={new Date().toISOString()}
                actions={null}
              >
                <PendingBody />
              </PostFrame>
            }
          />
        )}
      </ol>
      {pager("mt-3")}
      <ConversationSync
        key={newest?.id}
        id={conversation.id}
        mark={last && (conversation.isUnread || notifications > 0)}
        scroll={last && !inPlace}
      />
    </>
  );
}
