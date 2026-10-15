import { feedList } from "@sermo/core/contracts";
import { FeedItem } from "@/app/[locale]/(main)/_feed/feed-item";
import type { ListPage } from "@/lib/list-pages";
import { read } from "@/lib/sermo/client";
import { authorsFor } from "@/lib/sermo/members";
import { getReactionTypes, pickerTypes } from "@/lib/sermo/reactions";
import { getViewer } from "@/lib/sermo/session";
import { threadMembers } from "@/lib/sermo/threads";

export const TABS = ["latest", "following", "hot"] as const;

export type Tab = (typeof TABS)[number];

// `top` is the former name of `hot`: old links and bookmarks keep working.
export function tabOf(value: unknown): Tab {
  return (
    TABS.find((tab) => tab === (value === "top" ? "hot" : value)) ?? "latest"
  );
}

export function feedHref(tab: Tab, cursor?: string) {
  const params = new URLSearchParams();
  if (tab !== "latest") params.set("tab", tab);
  if (cursor) params.set("cursor", cursor);
  const query = params.toString();
  return query ? `/?${query}` : "/";
}

// One page of the feed, drawn: the home page's first page and each page the browser asks for.
export async function feedPage(
  tab: Tab,
  cursor?: string,
  reader: typeof read = read,
): Promise<ListPage> {
  const [feed, viewer, reactionTypes] = await Promise.all([
    reader(feedList, { scope: tab, cursor }),
    getViewer(),
    getReactionTypes(),
  ]);
  const author = await authorsFor(
    feed.items.flatMap((item) =>
      item.type === "profilePost"
        ? [
            item.profilePost.author,
            ...item.profilePost.latestComments.map((comment) => comment.author),
          ]
        : [item.post.author, ...threadMembers(item.thread)],
    ),
  );
  // A reaction type may be limited to forums: what is offered depends on the forum of the item.
  const pickerFor = (forumId: number | null) =>
    viewer.permissions.canReact ? pickerTypes(reactionTypes, forumId) : [];
  const now = Date.now();
  return {
    nextCursor: feed.nextCursor,
    rows: feed.items.map((item) => {
      // `latest` lists a thread once, at its newest post: a thread that moved up is the same row,
      // so the entries put in front of a list in the browser replace it. The other tabs list a
      // post each.
      const key =
        item.type === "profilePost"
          ? `profilePost-${item.profilePost.id}`
          : tab === "latest"
            ? `thread-${item.thread.id}`
            : `${item.type}-${item.post.id}`;
      return {
        key,
        at: item.createdAt,
        node: (
          <FeedItem
            item={item}
            author={author}
            now={now}
            viewerId={viewer.user?.id ?? null}
            picker={pickerFor(
              item.type === "profilePost" ? null : item.thread.node.id,
            )}
            reactionTypes={reactionTypes}
          />
        ),
      };
    }),
  };
}
