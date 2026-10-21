// How long a post stays new to a member who has not read it. The backend counts a thread as read
// once its last post is older than this (`Thread.isUnread`), as XenForo did (its read-marking
// lifetime), so a post is never marked new in a thread its list shows as read.
export const NEW_FOR_MS = 30 * 86_400_000;

// Whether a post carries the "New" badge: for a signed-in viewer, a post after the newest one they
// have read in this thread (`Thread.readPosition`, null when they never opened it, so every post
// counts) and written in the last 30 days. Guests have no read position and never see the badge.
export function isNewPost(
  post: { position: number; createdAt: string },
  viewer: { signedIn: boolean; readPosition: number | null },
  now: number,
) {
  return (
    viewer.signedIn &&
    post.position > (viewer.readPosition ?? -1) &&
    Date.parse(post.createdAt) > now - NEW_FOR_MS
  );
}
