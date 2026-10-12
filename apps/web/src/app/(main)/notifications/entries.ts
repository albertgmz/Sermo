import "server-only";

import {
  type notificationsList,
  postsGet,
  profileCommentsGet,
  profilePostsGet,
} from "@sermo/core/contracts";
import type * as z from "zod";
import { threadHref } from "@/app/(main)/threads/[id]/pages";
import { call } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";
import { membersFor } from "@/lib/sermo/members";
import { getReactionTypes } from "@/lib/sermo/reactions";

export type ApiNotification = z.output<
  typeof notificationsList.output
>["items"][number];

export type NotificationEntry = {
  item: ApiNotification;
  href: string;
  // The emoji of the reaction a reaction notification is about; empty for the rest.
  emoji: string;
};

const FALLBACK = "/notifications";

// The path the backend names for a notification, in the shape of this site's routes. Wall posts
// and comments have no page of their own here: they are found on the profile they were written on.
async function hrefOf(item: ApiNotification): Promise<string> {
  try {
    if (item.contentType === "post" && item.threadId !== null) {
      const post = await call(postsGet, { postId: item.contentId });
      return threadHref(item.threadId, post.position, post.id);
    }
    if (item.contentType === "profile_post") {
      const post = await call(profilePostsGet, {
        profilePostId: item.contentId,
      });
      return `/members/${post.profileUserId}#profile-post-${post.id}`;
    }
    if (item.contentType === "profile_post_comment") {
      const comment = await call(profileCommentsGet, {
        commentId: item.contentId,
      });
      const post = await call(profilePostsGet, {
        profilePostId: comment.profilePostId,
      });
      return `/members/${post.profileUserId}#profile-post-${post.id}`;
    }
  } catch (error) {
    // Content the viewer can no longer open: the backend's own path is the best that is left.
    if (!(error instanceof SermoError)) throw error;
  }
  const users = /^\/users\/(\d+)$/.exec(item.url);
  if (users) return `/members/${users[1]}`;
  // Announcements and reports have no page here yet.
  return /^\/(announcements|reports|profile-posts|profile-comments)\//.test(
    item.url,
  )
    ? FALLBACK
    : item.url;
}

// Everything a list of notifications needs to be drawn: where each one leads, the reaction's
// emoji and the members it names (one batched lookup).
export async function notificationEntries(items: ApiNotification[]) {
  const [types, hrefs, member] = await Promise.all([
    getReactionTypes(),
    Promise.all(items.map(hrefOf)),
    membersFor(items.flatMap((item) => item.actors)),
  ]);
  const entries: NotificationEntry[] = items.map((item, index) => {
    const typeId = item.data.reactionTypeId;
    return {
      item,
      href: hrefs[index],
      emoji:
        (typeof typeId === "number" &&
          types.find((type) => type.id === typeId)?.emoji) ||
        "",
    };
  });
  return { entries, member };
}
