import type { nodesList } from "@sermo/core/contracts";
import { subtreeTotals } from "@sermo/core/subtree-totals";
import type * as z from "zod";
import type { ForumCardData } from "@/components/forum/forum-card";
import { threadOpenHref } from "./open-links";
import type { MemberView } from "./views";

export type ApiNode = z.output<typeof nodesList.output>["items"][number];

// Groups the flat, depth-first node list by parent. Each group keeps the order of the list.
export function childrenByParent(nodes: ApiNode[]) {
  const groups = new Map<number | null, ApiNode[]>();
  for (const node of nodes) {
    const group = groups.get(node.parentId) ?? [];
    group.push(node);
    groups.set(node.parentId, group);
  }
  return (parentId: number) => groups.get(parentId) ?? [];
}

// The members a list of nodes shows: the authors of their last posts.
export function nodeMembers(nodes: ApiNode[]) {
  return nodes.flatMap((node) => (node.lastPost ? [node.lastPost.user] : []));
}

// The members the cards of these forums show: the authors of their shown last posts, which may
// lie in a forum under them.
export function cardMembers(
  forums: ApiNode[],
  childrenOf: (parentId: number) => ApiNode[],
) {
  return forums.flatMap((forum) => {
    const { lastPost } = subtreeTotals(forum, childrenOf);
    return lastPost ? [lastPost.user] : [];
  });
}

// A node from the backend in the shape of the forum card. Its direct children are the forum's
// sub-forums; its totals include every forum under it.
export function forumCard(
  node: ApiNode,
  childrenOf: (parentId: number) => ApiNode[],
  member: (id: number) => MemberView,
  unread: boolean,
  signedIn: boolean,
): ForumCardData {
  const { threadCount, postCount, lastPost } = subtreeTotals(node, childrenOf);
  return {
    id: node.id,
    title: node.title,
    icon: node.iconKey ?? "",
    image: (node.cover ?? node.icon)?.url ?? null,
    subforums: childrenOf(node.id).map(({ id, title }) => ({ id, title })),
    threadCount,
    postCount,
    unread,
    lastPost: lastPost && {
      threadId: lastPost.threadId,
      href: threadOpenHref(lastPost.threadId, signedIn),
      threadTitle: lastPost.threadTitle,
      prefix: null,
      createdAt: lastPost.postedAt,
      author: {
        username: lastPost.user.username,
        member: member(lastPost.user.id),
      },
    },
  };
}
