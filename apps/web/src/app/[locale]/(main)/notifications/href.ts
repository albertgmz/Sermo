import "server-only";

import type { notificationsList } from "@sermo/core/contracts";
import type * as z from "zod";
import { conversationHref } from "@/app/[locale]/(main)/conversations/[id]/message-target";

export type ApiNotification = z.output<
  typeof notificationsList.output
>["items"][number];

// Where a notification that has no page of its own for the member leads: the list.
export const FALLBACK = "/notifications";

// The kinds of content a moderator can be asked to approve; the panel has a screen for each.
const APPROVABLE = [
  "post",
  "profile_post",
  "profile_post_comment",
  "conversation_message",
];

// Where a notification leads: what it is about, or the screen where staff act on it. Null where
// the notification has no page of its own.
function targetOf(item: ApiNotification): string | null {
  if (item.type === "moderator.report" && item.contentType === "report_group") {
    return `/moderation/reports/${item.contentId}`;
  }
  if (
    item.type === "moderator.approval" &&
    APPROVABLE.includes(item.contentType)
  ) {
    return `/moderation/approvals/${item.contentType}/${item.contentId}`;
  }
  // An account waiting in the sign-up queue: the queue, where staff who may decide find it.
  if (item.type === "moderator.signup" && item.contentType === "user") {
    return "/moderation/signups";
  }
  // A new follower is the news: the notification names the member who followed, not the viewer.
  if (item.type === "member.followed") {
    const follower = item.actors[0];
    return follower ? `/members/${follower.id}` : null;
  }
  // Content is linked by its own address, which goes to the page that holds it, at the item:
  // the list asks the backend nothing per row.
  switch (item.contentType) {
    case "post":
      return `/posts/${item.contentId}`;
    case "thread":
      return `/threads/${item.contentId}`;
    case "profile_post":
      return `/profile-posts/${item.contentId}`;
    case "profile_post_comment":
      return `/profile-comments/${item.contentId}`;
    case "conversation":
      return conversationHref(item.contentId);
    case "conversation_message":
      return `/conversations/messages/${item.contentId}`;
    case "user":
      return `/members/${item.contentId}`;
    default:
      return null;
  }
}

// The path the backend names for a notification, in the shape of this site's routes.
export async function hrefOf(item: ApiNotification): Promise<string> {
  // An announcement's address is the one the administrator gave, or the list when it has none.
  if (item.contentType === "announcement") {
    return /^\/announcements\/\d+$/.test(item.url) ? FALLBACK : item.url;
  }
  const target = targetOf(item);
  if (target !== null) return target;
  const user = /^\/users\/(\d+)$/.exec(item.url);
  if (user) return `/members/${user[1]}`;
  // Reports have no page for a member.
  return /^\/reports\//.test(item.url) ? FALLBACK : item.url;
}
