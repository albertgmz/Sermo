"use server";

import type { ReactNode } from "react";
import {
  ForumThreadPages,
  threadsPage,
} from "@/app/[locale]/(main)/forums/[id]/thread-page";
import { call } from "@/lib/sermo/client";
import { requireIds } from "@/lib/sermo/ids";
import { drawnOrNull } from "@/lib/sermo/list-actions";

// A page of a forum's threads, drawn as the forum page draws it, for the pager that turns the pages
// in place (`PageSwitch`). The rows read the session and the LITE cookie here, as on a page load.
// Null for a page with nothing on it (past the end) or one the backend refuses: the browser then
// opens the address as a page of its own.
export async function forumThreadsPage(
  nodeId: number,
  prefixId: number | undefined,
  page: number,
): Promise<ReactNode | null> {
  requireIds(nodeId, page, ...(prefixId === undefined ? [] : [prefixId]));
  return drawnOrNull(async () => {
    const list = await threadsPage(nodeId, prefixId, page, call);
    if (list.rows.length === 0) return null;
    return (
      <ForumThreadPages
        nodeId={nodeId}
        prefixId={prefixId}
        page={page}
        list={list}
      />
    );
  });
}
