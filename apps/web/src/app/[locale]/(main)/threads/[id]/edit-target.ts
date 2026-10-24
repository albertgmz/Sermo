// What is edited where it is read (XenForo's quick edit) and on its edit page: a post of a thread
// or a message of a conversation. Both are edited with the same editor and the same page form;
// only the writes, the edit page's address and what the form offers around the text differ. This
// module is in the first load of the pages that draw posts: it imports nothing (the thread's page
// helpers bring the backend's contracts with them).
export type EditTarget =
  | { kind: "post"; threadId: number; postId: number }
  | { kind: "message"; conversationId: number; messageId: number };

// What its editor in the page keeps for the edit page (`keepEditDraft`). A message's is named
// apart from a post's, so the text of a private message never opens in the edit page of a post
// that shares its number.
export const draftOf = (target: EditTarget) =>
  target.kind === "post"
    ? target.postId
    : (`message:${target.messageId}` as const);

// Where a save made in place is kept for the page (`lib/item-state`), one per item.
export const savedKey = (target: EditTarget) =>
  target.kind === "post"
    ? `post-edit:${target.postId}`
    : `message-edit:${target.messageId}`;
