"use server";

import { feedPage, tabOf } from "@/app/[locale]/(main)/_feed/feed-page";

// The next page of the feed, drawn on the server so the cards keep reading the session and the
// LITE cookie. Called as the visitor scrolls.
export async function moreFeed(tab: string, cursor: string) {
  return feedPage(tabOf(tab), cursor);
}
