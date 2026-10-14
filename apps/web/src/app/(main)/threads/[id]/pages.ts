import { POSTS_PER_PAGE } from "@/lib/sermo/page-sizes";

// The page that holds the post at `position`; positions never change.
export function pageOf(position: number) {
  return Math.floor(position / POSTS_PER_PAGE) + 1;
}

// How many pages a member sees, from the position of the newest visible post.
export function pageCount(lastPosition: number) {
  return pageOf(lastPosition);
}

export function threadHref(
  threadId: number,
  position: number,
  postId?: number,
) {
  const page = pageOf(position);
  return `/threads/${threadId}${page > 1 ? `?page=${page}` : ""}${postId === undefined ? "" : `#post-${postId}`}`;
}

// A post's address relative to the thread page being read, so the slug the visitor arrived by
// stays: `?page=N#post-ID`, with no query on the first page.
export function postPermalink(position: number, postId: number) {
  const page = pageOf(position);
  return `${page > 1 ? `?page=${page}` : "?"}#post-${postId}`;
}
