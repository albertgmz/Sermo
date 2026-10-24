import {
  bookmarksList,
  conversationsListMessages,
  notificationsList,
  postsByAuthor,
  postsList,
  searchQuery,
  tagsThreads,
  threadsByAuthor,
  threadsList,
  usersList,
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

// Results in a page of a search (`search.query`), alerts in a page of the alerts list, bookmarks in
// a page of the bookmarks, members in a page of the directory and of a ranking (`users.list`), and
// threads and posts in a page of a member's profile lists.
export const SEARCH_RESULTS_PER_PAGE = searchQuery.input.parse({
  q: "a",
}).limit;
export const NOTIFICATIONS_PER_PAGE = notificationsList.input.parse({}).limit;
export const BOOKMARKS_PER_PAGE = bookmarksList.input.parse({}).limit;
export const MEMBERS_PER_PAGE = usersList.input.parse({}).limit;
export const AUTHOR_THREADS_PER_PAGE = threadsByAuthor.input.parse({
  userId: 1,
}).limit;
export const AUTHOR_POSTS_PER_PAGE = postsByAuthor.input.parse({
  userId: 1,
}).limit;
