import "server-only";

import {
  ModerationTarget,
  postsGet,
  profileCommentsGet,
  profilePostsGet,
  ReportTarget,
  threadsGet,
} from "@sermo/core/contracts";
import { wallTargetHref } from "@/app/[locale]/(main)/members/[id]/wall-target";
import type { ContentRef } from "@/components/staff/content-ip";
import { call } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";

// What a report or an approval points at, as far as the backend lets a moderator read it. A
// private message is never read here: it is only opened through the audited operations.

export const REPORT_TYPES = ReportTarget.shape.type.options;
export const APPROVAL_TYPES = ModerationTarget.shape.type.options;

export type TargetType =
  | (typeof REPORT_TYPES)[number]
  | (typeof APPROVAL_TYPES)[number];

export type Described = {
  author: { id: number; username: string } | null;
  // The backend's sanitised HTML, or null when the target has none to show.
  bodyHtml: string | null;
  // A plain-text start of the content, for lists.
  excerpt: string;
  state: "visible" | "moderated" | "deleted" | null;
  // The public address of the content, and what it sits in.
  href: string | null;
  where: {
    kind: "thread" | "wall" | "forum";
    id: number;
    title?: string;
  } | null;
  createdAt: string | null;
  // What the IP log knows the content by (a thread by its first post), for "View IPs".
  ipFrom: ContentRef | null;
};

const EXCERPT = 140;

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

// The text of sanitised HTML, cut for a list row.
export function plainExcerpt(html: string, length = EXCERPT) {
  const text = html
    .replace(/<(?:br|\/p|\/li|\/h\d|\/blockquote)\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:amp|lt|gt|quot|nbsp|#39);/g, (entity) => ENTITIES[entity])
    .replace(/\s+/g, " ")
    .trim();
  return text.length > length ? `${text.slice(0, length).trimEnd()}…` : text;
}

// The backend refuses a target the viewer may not read, or one that is gone: the row then shows
// only its type and id.
export async function orGone<T>(run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    if (
      error instanceof SermoError &&
      (error.code === "not_found" || error.code === "forbidden")
    ) {
      return null;
    }
    throw error;
  }
}

const nothing: Described = {
  author: null,
  bodyHtml: null,
  excerpt: "",
  state: null,
  href: null,
  where: null,
  createdAt: null,
  ipFrom: null,
};

// The detail pages' read of a target. The queues' rows carry their own excerpt and place.
export async function describe(
  type: TargetType,
  id: number,
): Promise<Described> {
  if (type === "post") {
    const post = await orGone(() => call(postsGet, { postId: id }));
    if (!post) return nothing;
    const thread = await orGone(() =>
      call(threadsGet, { threadId: post.threadId, countView: false }),
    );
    return {
      author: post.author,
      bodyHtml: post.bodyHtml,
      excerpt: plainExcerpt(post.bodyHtml),
      state: post.state,
      href: `/threads/${post.threadId}#post-${post.id}`,
      where: {
        kind: "thread",
        id: post.threadId,
        title: thread?.thread.title,
      },
      createdAt: post.createdAt,
      ipFrom: { type: "post", id: post.id },
    };
  }
  if (type === "thread") {
    const found = await orGone(() =>
      call(threadsGet, { threadId: id, countView: false }),
    );
    if (!found) return nothing;
    const { thread } = found;
    const first = await orGone(() =>
      call(postsGet, { postId: thread.firstPostId }),
    );
    return {
      author: thread.author,
      bodyHtml: first?.bodyHtml ?? null,
      excerpt: thread.excerpt,
      state: thread.state,
      href: `/threads/${thread.id}`,
      where: { kind: "forum", id: thread.node.id, title: thread.node.title },
      createdAt: thread.createdAt,
      ipFrom: { type: "post", id: thread.firstPostId },
    };
  }
  if (type === "profile_post") {
    const post = await orGone(() =>
      call(profilePostsGet, { profilePostId: id }),
    );
    if (!post) return nothing;
    return {
      author: post.author,
      bodyHtml: post.bodyHtml,
      excerpt: plainExcerpt(post.bodyHtml),
      state: post.state,
      href: wallTargetHref(post.profileUserId, post.id),
      where: { kind: "wall", id: post.profileUserId },
      createdAt: post.createdAt,
      ipFrom: { type: "profile_post", id: post.id },
    };
  }
  if (type === "profile_post_comment") {
    const comment = await orGone(() =>
      call(profileCommentsGet, { commentId: id }),
    );
    if (!comment) return nothing;
    const post = await orGone(() =>
      call(profilePostsGet, { profilePostId: comment.profilePostId }),
    );
    return {
      author: comment.author,
      bodyHtml: comment.bodyHtml,
      excerpt: plainExcerpt(comment.bodyHtml),
      state: comment.state,
      href: post
        ? wallTargetHref(post.profileUserId, post.id, comment.id)
        : null,
      where: post ? { kind: "wall", id: post.profileUserId } : null,
      createdAt: comment.createdAt,
      ipFrom: { type: "profile_post_comment", id: comment.id },
    };
  }
  return nothing;
}
