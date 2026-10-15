import { feedList } from "@sermo/core/contracts";
import { FeedItem } from "@/app/[locale]/(main)/_feed/feed-item";
import type { ListPage } from "@/lib/list-pages";
import { read } from "@/lib/sermo/client";
import { authorsFor } from "@/lib/sermo/members";
import { getReactionTypes, pickerTypes } from "@/lib/sermo/reactions";
import { getViewer } from "@/lib/sermo/session";
import { threadMembers } from "@/lib/sermo/threads";

export const TABS = ["latest", "following", "top"] as const;

export type Tab = (typeof TABS)[number];

export function tabOf(value: unknown): Tab {
  return TABS.find((tab) => tab === value) ?? "latest";
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
  const picker = viewer.permissions.canReact ? pickerTypes(reactionTypes) : [];
  const now = Date.now();
  return {
    nextCursor: feed.nextCursor,
    rows: feed.items.map((item) => {
      const key = `${item.type}-${item.type === "profilePost" ? item.profilePost.id : item.post.id}`;
      return {
        key,
        at: item.createdAt,
        node: (
          <FeedItem
            item={item}
            author={author}
            now={now}
            viewerId={viewer.user?.id ?? null}
            picker={picker}
            reactionTypes={reactionTypes}
          />
        ),
      };
    }),
  };
}
