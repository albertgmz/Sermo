"use server";

import { feedPage, tabOf } from "@/app/[locale]/(main)/_feed/feed-page";
import { call } from "@/lib/sermo/client";
import { endQuietly } from "@/lib/sermo/list-actions";

// A page of the feed after the first, drawn on the server so the cards keep reading the session
// and the LITE cookie. Called as the visitor scrolls; `null` is the first page (a refresh).
export async function moreFeed(tab: string, cursor: string | null) {
  return endQuietly(() => feedPage(tabOf(tab), cursor ?? undefined, call));
}
