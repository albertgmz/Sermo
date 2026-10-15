"use server";

import { feedNewCount } from "@sermo/core/contracts";
import { feedPage, tabOf } from "@/app/[locale]/(main)/_feed/feed-page";
import { mediaPage } from "@/app/[locale]/(main)/_feed/media-page";
import { call, callForPoll } from "@/lib/sermo/client";
import { endQuietly } from "@/lib/sermo/list-actions";
import { type PollStop, pollQuietly } from "@/lib/sermo/poll-actions";

// A page of the feed after the first, drawn on the server so the cards keep reading the session
// and the LITE cookie. Called as the visitor scrolls; `null` is the first page (a refresh).
export async function moreFeed(tab: string, cursor: string | null) {
  return endQuietly(() => feedPage(tabOf(tab), cursor ?? undefined, call));
}

// How many entries are newer than `since`, the time of the newest one the visitor holds: usually
// none, from one index read. A tab that has nothing to poll (the ranked one, or the followed
// members' tab without an account) or a session that ended answers `stop`.
export async function newFeedCount(
  tab: string,
  since: string,
): Promise<{ count: number; more: boolean } | PollStop> {
  const scope = tab === "following" ? "following" : "latest";
  if (tab !== scope) return { stop: true };
  return pollQuietly(() => callForPoll(feedNewCount, { scope, since }));
}

// A page of the media tab after the first, drawn on the server like the feed's.
export async function moreMedia(cursor: string | null) {
  return endQuietly(() => mediaPage(cursor ?? undefined, call));
}
