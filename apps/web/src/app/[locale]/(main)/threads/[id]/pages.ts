import { POSTS_PER_PAGE } from "@/lib/sermo/page-sizes";

// The page that holds the post at `position`; positions never change.
export function pageOf(position: number) {
  return Math.floor(position / POSTS_PER_PAGE) + 1;
}

// How many pages a member sees, from the position of the newest visible post.
export function pageCount(lastPosition: number) {
  return pageOf(lastPosition);
}

// The address of a page of a thread; page one has the plain address.
export function threadPageHref(threadId: number, page: number) {
  return `/threads/${threadId}${page > 1 ? `?page=${page}` : ""}`;
}

export function threadHref(
  threadId: number,
  position: number,
  postId?: number,
) {
  return `${threadPageHref(threadId, pageOf(position))}${postId === undefined ? "" : `#post-${postId}`}`;
}
