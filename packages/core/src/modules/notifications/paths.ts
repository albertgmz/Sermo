/**
 * The address of the content an alert is about, where it has one of its own: a post, a wall post,
 * a comment and a message each go to the page that holds them, at the item, so the alert never
 * needs to know the page. Null for content without such an address.
 */
export function contentPath(
  contentType: string,
  contentId: number,
  threadId: number | null,
): string | null {
  switch (contentType) {
    case "post":
      return `/posts/${contentId}`;
    case "profile_post":
      return `/profile-posts/${contentId}`;
    case "profile_post_comment":
      return `/profile-comments/${contentId}`;
    case "conversation":
      return `/conversations/${contentId}`;
    case "conversation_message":
      return `/conversations/messages/${contentId}`;
  }
  return threadId ? `/threads/${threadId}` : null;
}
