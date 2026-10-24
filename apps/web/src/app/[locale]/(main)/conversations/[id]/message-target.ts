import { pageAddress } from "@/components/forum/page-window";

// The address of a conversation, or of one message in it; the fragment names the element to bring
// into view. With the number of the page that holds the message (`conversations.locateMessage`
// gives it), the address is that page's; without it, `message` names the message and the
// conversation page finds its page.
export function conversationHref(
  conversationId: number,
  messageId?: number,
  page?: number,
) {
  const path = `/conversations/${conversationId}`;
  if (messageId === undefined) return path;
  if (page !== undefined)
    return `${pageAddress(path, {}, page)}#message-${messageId}`;
  return `${path}?message=${messageId}#message-${messageId}`;
}

// The page that edits a message, the fallback of the edit made in place.
export function messageEditHref(conversationId: number, messageId: number) {
  return `/conversations/${conversationId}/edit/${messageId}`;
}
