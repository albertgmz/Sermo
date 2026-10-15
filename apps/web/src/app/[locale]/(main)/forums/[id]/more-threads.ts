"use server";

import { threadsPage } from "@/app/[locale]/(main)/forums/[id]/thread-page";

// The next page of a forum's threads, drawn on the server so the rows keep reading the session
// and the LITE cookie. Called as the visitor scrolls.
export async function moreThreads(
  nodeId: number,
  prefixId: number | undefined,
  cursor: string,
) {
  return threadsPage(nodeId, prefixId, cursor);
}
