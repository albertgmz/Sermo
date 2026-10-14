import "server-only";

import {
  type notificationsList,
  postsGet,
  profileCommentsGet,
  profilePostsGet,
} from "@sermo/core/contracts";
import type * as z from "zod";
import { conversationHref } from "@/app/(main)/conversations/[id]/message-target";
import { wallTargetHref } from "@/app/(main)/members/[id]/wall-target";
import { threadHref } from "@/app/(main)/threads/[id]/pages";
import { call } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";

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

const conversationOf = (item: ApiNotification) => {
  const id = item.data.conversationId;
  return typeof id === "number" ? id : null;
};

// The page that holds what a notification is about, with the anchor of the element: the page of
// the thread and the post, the wall post or comment, the conversation message. Null where the
// notification has no page of its own.
async function targetOf(item: ApiNotification): Promise<string | null> {
  if (item.type === "moderator.report" && item.contentType === "report_group") {
    return `/moderation/reports/${item.contentId}`;
  }
  if (
    item.type === "moderator.approval" &&
    APPROVABLE.includes(item.contentType)
  ) {
    return `/moderation/approvals/${item.contentType}/${item.contentId}`;
  }
  // A new follower is the news: the notification names the member who followed, not the viewer.
  if (item.type === "member.followed") {
    const follower = item.actors[0];
    return follower ? `/members/${follower.id}` : null;
  }
  switch (item.contentType) {
    case "post": {
      if (item.threadId === null) return null;
      const post = await call(postsGet, { postId: item.contentId });
      return threadHref(item.threadId, post.position, post.id);
    }
    case "thread":
      return `/threads/${item.contentId}`;
    case "profile_post": {
      const post = await call(profilePostsGet, {
        profilePostId: item.contentId,
      });
      return wallTargetHref(post.profileUserId, post.id);
    }
    case "profile_post_comment": {
      const comment = await call(profileCommentsGet, {
        commentId: item.contentId,
      });
      const post = await call(profilePostsGet, {
        profilePostId: comment.profilePostId,
      });
      return wallTargetHref(post.profileUserId, post.id, comment.id);
    }
    case "conversation":
      return conversationHref(item.contentId);
    case "conversation_message": {
      const conversationId = conversationOf(item);
      return conversationId === null
        ? "/conversations"
        : conversationHref(conversationId, item.contentId);
    }
    case "user":
      return `/members/${item.contentId}`;
    default:
      return null;
  }
}

// The path the backend names for a notification, in the shape of this site's routes.
export async function hrefOf(item: ApiNotification): Promise<string> {
  try {
    const target = await targetOf(item);
    if (target !== null) return target;
  } catch (error) {
    // Content the viewer can no longer open: the backend's own path is the best that is left.
    if (!(error instanceof SermoError)) throw error;
  }
  // Announcements and reports have no page for a member; the backend's wall and comment paths
  // are not routes here.
  return /^\/(announcements|reports|profile-posts|profile-comments)\//.test(
    item.url,
  )
    ? FALLBACK
    : item.url;
}
