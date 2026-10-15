"use server";

import { threadsPage } from "@/app/[locale]/(main)/forums/[id]/thread-page";
import { call } from "@/lib/sermo/client";
import { endQuietly } from "@/lib/sermo/list-actions";

// A page of a forum's threads after the first, drawn on the server so the rows keep reading the
// session and the LITE cookie. Called as the visitor scrolls; `null` is the first page.
export async function moreThreads(
  nodeId: number,
  prefixId: number | undefined,
  cursor: string | null,
) {
  return endQuietly(() =>
    threadsPage(nodeId, prefixId, cursor ?? undefined, call),
  );
}
