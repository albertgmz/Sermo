import { postsList } from "@sermo/core/contracts";

// The contract exports no page size. Every list takes the default `limit` of its input, so the
// size is read from the contract's own schema and follows it when the backend changes it.

// How many posts the backend serves in a thread page (`posts.list` without a `limit`).
export const POSTS_PER_PAGE = postsList.input.parse({ threadId: 1 }).limit;
