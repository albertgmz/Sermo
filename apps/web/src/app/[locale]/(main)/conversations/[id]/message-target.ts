// The address of a conversation, or of one message in it. The page opens at the page of messages
// that holds the message (`message`); the fragment names the element to bring into view.
export function conversationHref(conversationId: number, messageId?: number) {
  return messageId === undefined
    ? `/conversations/${conversationId}`
    : `/conversations/${conversationId}?message=${messageId}#message-${messageId}`;
}

// The page that edits a message, the fallback of the edit made in place.
export function messageEditHref(conversationId: number, messageId: number) {
  return `/conversations/${conversationId}/edit/${messageId}`;
}
