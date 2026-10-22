import type { postsList, threadsGet } from "@sermo/core/contracts";
import type * as z from "zod";
import type { ThreadCardData } from "@/components/forum/thread-hover-card";
import type { MemberView, PrefixView } from "./views";

export type ApiThread = z.output<typeof threadsGet.output>["thread"];
export type ApiPost = z.output<typeof postsList.output>["items"][number];

// The members a thread shows: who started it and who wrote the last post.
export function threadMembers(thread: ApiThread) {
  return [thread.author, thread.lastPost.user];
}

export function prefixView(prefix: ApiThread["prefix"]): PrefixView | null {
  return prefix && { ...prefix };
}

// The prefixes of a list that members may put on a thread now: the active ones.
export function activePrefixViews(
  items: readonly (NonNullable<ApiThread["prefix"]> & { isActive: boolean })[],
): PrefixView[] {
  return items.flatMap((prefix) =>
    prefix.isActive ? (prefixView(prefix) ?? []) : [],
  );
}

// The prefixes a form offers for a thread that already has one: the ones on offer, and the
// thread's own when it is no longer one of them (retired, or its forum stopped offering it),
// marked as such, so that saving the form keeps it.
export function prefixChoices(
  active: PrefixView[],
  stored: ApiThread["prefix"],
  inactive: (label: string) => string,
): PrefixView[] {
  const own = prefixView(stored);
  if (!own || active.some(({ id }) => id === own.id)) return active;
  return [...active, { ...own, label: inactive(own.label) }];
}

// A backend thread in the shape the shared thread components take.
export function threadCard(
  thread: ApiThread,
  member: (id: number) => MemberView,
): ThreadCardData {
  return {
    id: thread.id,
    title: thread.title,
    prefix: prefixView(thread.prefix),
    excerpt: thread.excerpt,
    createdAt: thread.createdAt,
    views: thread.viewCount,
    replyCount: thread.replyCount,
    coverPicture: thread.cover && { url: thread.cover.url },
    forum: thread.node,
    author: { member: member(thread.author.id) },
    lastPost: {
      createdAt: thread.lastPost.postedAt,
      author: { member: member(thread.lastPost.user.id) },
    },
  };
}
