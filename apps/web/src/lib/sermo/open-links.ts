// Where a link to a whole thread or conversation opens, as XenForo's lists do: a member lands where
// they left off (the first unread post, else the newest one; the `/unread` addresses settle it), a
// guest has no reading position and gets the start. The address a guest is given is the plain
// thread address, the same one a search engine sees. A link to one post or message (an alert, a
// quoted place, a bookmark of a post) names that item and does not come here.

export function threadOpenHref(threadId: number, signedIn: boolean) {
  return signedIn ? `/threads/${threadId}/unread` : `/threads/${threadId}`;
}

// Conversations are for members only, so there is no guest form. A summary's last message is not
// used: it can be one the viewer may not see (a first message held for approval).
export function conversationOpenHref(conversationId: number) {
  return `/conversations/${conversationId}/unread`;
}
