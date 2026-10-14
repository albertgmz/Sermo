// The address of one wall post, or of one comment on it, on the member's wall. The wall opens at
// the page that holds it (`post`) and shows the page of comments that holds the comment
// (`comment`); the fragment names the element to bring into view.
export function wallTargetHref(
  profileId: number,
  postId: number,
  commentId?: number,
) {
  const query = new URLSearchParams({ post: String(postId) });
  if (commentId !== undefined) query.set("comment", String(commentId));
  const anchor =
    commentId === undefined
      ? `profile-post-${postId}`
      : `profile-comment-${commentId}`;
  return `/members/${profileId}?${query}#${anchor}`;
}
