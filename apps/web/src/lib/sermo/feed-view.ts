import "server-only";

import { cookies } from "next/headers";
import {
  DEFAULT_FEED_VIEW,
  FEED_VIEW_COOKIE,
  type FeedView,
  parseFeedView,
} from "@/lib/feed-view";
import { getViewer } from "./session";

// How this visitor wants the feed drawn: a member's choice comes with the session; a guest's is in
// a cookie, and so is the choice of a member whose group may not edit their own profile (the
// account cannot hold it for them: `setFeedView`). Cards until they choose.
export async function getFeedView(): Promise<FeedView> {
  const { user, resolvedPermissions } = await getViewer();
  if (user && resolvedPermissions["profile.editOwn"] !== false)
    return parseFeedView(user.feedView) ?? DEFAULT_FEED_VIEW;
  const store = await cookies();
  return parseFeedView(store.get(FEED_VIEW_COOKIE)?.value) ?? DEFAULT_FEED_VIEW;
}
