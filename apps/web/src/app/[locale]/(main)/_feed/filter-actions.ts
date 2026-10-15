"use server";

import {
  FEED_SCOPES,
  feedDeleteFilter,
  feedHideForum,
  feedOptions,
  feedSaveFilter,
  nodesList,
  threadPrefixesList,
} from "@sermo/core/contracts";
import type { FeedFilterValue } from "@/lib/feed-filters";
import { call } from "@/lib/sermo/client";
import { requireIds } from "@/lib/sermo/ids";
import { attemptInPlace } from "@/lib/sermo/outcome";
import { pageOfRequest } from "@/lib/sermo/request-page";
import { getViewer } from "@/lib/sermo/session";

// The actions of the feed's filter sheet, apart from the feed's own so that the sheet's code does
// not reach the cards.

// What the filter sheet draws, read when it opens: the forums and prefixes to choose from, and
// for a member their saved filters and the forums they hide. Nothing is read by the page itself.
export type FilterOptions = {
  signedIn: boolean;
  forums: { id: number; title: string; depth: number }[];
  prefixes: { id: number; label: string }[];
  saved: {
    id: number;
    name: string;
    scope: "latest" | "following" | "hot";
    filter: FeedFilterValue;
  }[];
  hiddenForumIds: number[];
  excludedForumIds: number[];
  filterLimit: number;
};

export async function feedFilterOptions(): Promise<
  { ok: true; value: FilterOptions } | { ok: false; error: string }
> {
  const page = await pageOfRequest();
  return attemptInPlace(page, async () => {
    const [viewer, options, nodes, prefixes] = await Promise.all([
      getViewer(),
      call(feedOptions, {}),
      call(nodesList, {}),
      call(threadPrefixesList, {}),
    ]);
    return {
      signedIn: viewer.user !== null,
      forums: nodes.items.map(({ id, title, depth }) => ({ id, title, depth })),
      prefixes: prefixes.items.map(({ id, label }) => ({ id, label })),
      saved: options.filters.map(({ id, name, scope, filter }) => ({
        id,
        name,
        scope,
        filter,
      })),
      hiddenForumIds: options.hiddenForumIds,
      excludedForumIds: options.excludedForumIds,
      filterLimit: options.filterLimit,
    };
  });
}

// Saves the filter the member has on screen under a name (the same name replaces it), and returns
// the list they now hold.
export async function saveFeedFilter(
  name: string,
  tab: string,
  filter: FeedFilterValue,
) {
  const page = await pageOfRequest();
  return attemptInPlace(page, async () => {
    await call(feedSaveFilter, {
      name,
      scope: FEED_SCOPES.find((scope) => scope === tab) ?? "latest",
      filter,
    });
    return (await call(feedOptions, {})).filters;
  });
}

export async function deleteFeedFilter(filterId: number) {
  requireIds(filterId);
  const page = await pageOfRequest();
  return attemptInPlace(page, async () => {
    await call(feedDeleteFilter, { filterId });
    return (await call(feedOptions, {})).filters;
  });
}

// Keeps a forum out of the member's feed, or puts it back. The caller draws the page again.
export async function hideFeedForum(nodeId: number, hidden: boolean) {
  requireIds(nodeId);
  const page = await pageOfRequest();
  return attemptInPlace(page, async () => {
    await call(feedHideForum, { nodeId, hidden: hidden === true });
    return (await call(feedOptions, {})).hiddenForumIds;
  });
}
