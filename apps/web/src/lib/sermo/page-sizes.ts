import {
  conversationsListMessages,
  postsList,
  tagsThreads,
  threadsList,
} from "@sermo/core/contracts";

// The contract exports no page size. Every list takes the default `limit` of its input, so the
// size is read from the contract's own schema and follows it when the backend changes it.

// How many posts the backend serves in a thread page (`posts.list` without a `limit`).
export const POSTS_PER_PAGE = postsList.input.parse({ threadId: 1 }).limit;

// Threads in a numbered page of a forum (`threads.list`) and of a tag (`tags.threads`), sticky
// threads aside.
export const THREADS_PER_PAGE = threadsList.input.parse({ nodeId: 1 }).limit;
export const TAG_THREADS_PER_PAGE = tagsThreads.input.parse({
  name: "a",
}).limit;

// Messages in a page of a conversation (`conversations.listMessages`, and the page
// `conversations.locateMessage` names).
export const MESSAGES_PER_PAGE = conversationsListMessages.input.parse({
  conversationId: 1,
}).limit;
