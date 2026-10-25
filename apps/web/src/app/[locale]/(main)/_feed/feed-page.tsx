import { feedList } from "@sermo/core/contracts";
import { FeedItem } from "@/app/[locale]/(main)/_feed/feed-item";
import type { FeedFilterValue } from "@/lib/feed-filters";
import type { ListPage } from "@/lib/list-pages";
import type { AuthorRef } from "@/lib/sermo/authors";
import { read } from "@/lib/sermo/client";
import { getFeedView } from "@/lib/sermo/feed-view";
import { authorsFor } from "@/lib/sermo/members";
import { getReactionTypes, pickerTypes } from "@/lib/sermo/reactions";
import { getViewer } from "@/lib/sermo/session";
import { getSite } from "@/lib/sermo/site";
import { threadMembers } from "@/lib/sermo/threads";

// The tabs of the home page that are the feed; the others (the forum list, the pictures) have
// their own screens.
export const TABS = ["latest", "hot", "following"] as const;

export type Tab = (typeof TABS)[number];

export function tabOf(value: unknown): Tab {
  return TABS.find((tab) => tab === value) ?? "latest";
}

// One page of the feed, drawn: the home page's first page and each page the browser asks for. The
// filter narrows it; the backend decides what each field means and who may use it.
export async function feedPage(
  tab: Tab,
  cursor?: string,
  reader: typeof read = read,
  filter: FeedFilterValue = {},
): Promise<ListPage> {
  const [feed, viewer, reactionTypes, view, site] = await Promise.all([
    reader(feedList, { scope: tab, cursor, ...filter }),
    getViewer(),
    getReactionTypes(),
    getFeedView(),
    getSite(),
  ]);
  const author = await authorsFor([
    // The owner of a wall, named beside the author of a post made on another member's wall. The
    // answer fills in the name, and the refs below win over these, which carry none.
    ...feed.items.flatMap((item) =>
      item.type === "profilePost"
        ? [{ id: item.profilePost.profileUserId, username: "" }]
        : [],
    ),
    ...feed.items.flatMap<AuthorRef>((item) =>
      item.type === "profilePost"
        ? [
            item.profilePost.author,
            ...item.profilePost.latestComments.map((comment) => comment.author),
          ]
        : [item.post.author, ...threadMembers(item.thread)],
    ),
    // The viewer's avatar heads the composer under a wall post.
    ...(viewer.user ? [viewer.user] : []),
  ]);
  // A reaction type may be limited to forums: what is offered depends on the forum of the item.
  const pickerFor = (forumId: number | null) =>
    viewer.permissions.canReact ? pickerTypes(reactionTypes, forumId) : [];
  // Wall posts are reacted to with `profilePost.react`; who reacted needs `reaction.viewList`.
  const mayReactOnWalls =
    viewer.resolvedPermissions["profilePost.react"] !== false;
  const viewList = viewer.resolvedPermissions["reaction.viewList"] !== false;
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
            picker={
              item.type === "profilePost"
                ? mayReactOnWalls
                  ? pickerFor(null)
                  : []
                : item.post.canReact
                  ? pickerFor(item.thread.node.id)
                  : []
            }
            reactionTypes={reactionTypes}
            viewList={viewList}
            view={view}
            adultMode={site.adultMode}
          />
        ),
      };
    }),
  };
}
