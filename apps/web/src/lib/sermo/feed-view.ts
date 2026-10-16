import "server-only";

import { cookies } from "next/headers";
import {
  DEFAULT_FEED_VIEW,
  FEED_VIEW_COOKIE,
  type FeedView,
  parseFeedView,
} from "@/lib/feed-view";
import { getViewer } from "./session";

// How this visitor wants the feed drawn: a member's choice comes with the session, a guest's is in
// a cookie; cards until they choose.
export async function getFeedView(): Promise<FeedView> {
  const { user } = await getViewer();
  if (user) return parseFeedView(user.feedView) ?? DEFAULT_FEED_VIEW;
  const store = await cookies();
  return parseFeedView(store.get(FEED_VIEW_COOKIE)?.value) ?? DEFAULT_FEED_VIEW;
}
