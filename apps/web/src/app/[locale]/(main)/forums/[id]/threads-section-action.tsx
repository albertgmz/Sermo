"use server";

import { nodesGet } from "@sermo/core/contracts";
import type { ReactNode } from "react";
import {
  ForumThreads,
  NewThreadButton,
} from "@/app/[locale]/(main)/forums/[id]/forum-threads";
import { pageParam } from "@/components/forum/page-window";
import { queryOfSearch } from "@/components/forum/places";
import { call } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";
import { requireIds } from "@/lib/sermo/ids";
import { getViewer } from "@/lib/sermo/session";

// A forum's prefix filter and its threads as the address with `search` names them, for a prefix
// chosen in the filter (`TabSwitch`): read again as a page load reads them. Null for a node that is
// not a forum, or when the backend refuses: the browser then opens the address as a page of its
// own, which says what is the matter.
export async function forumThreadsSection(
  nodeId: number,
  search: string,
): Promise<ReactNode | null> {
  requireIds(nodeId);
  if (typeof search !== "string") return null;
  const { prefix, page } = queryOfSearch(search);
  try {
    const [{ node, resolvedPermissions }, { user }] = await Promise.all([
      call(nodesGet, { nodeId }),
      getViewer(),
    ]);
    if (node.type !== "forum") return null;
    return await ForumThreads({
      nodeId,
      prefix: typeof prefix === "string" ? prefix : undefined,
      page: pageParam(page),
      newThread: node.permissions.canPost && (
        <NewThreadButton nodeId={nodeId} />
      ),
      signedIn: user !== null,
      resolved: resolvedPermissions,
    });
  } catch (error) {
    if (error instanceof SermoError) return null;
    throw error;
  }
}
