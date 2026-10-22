import "server-only";

import { nodesUnread } from "@sermo/core/contracts";
import { read } from "./client";
import { getViewer } from "./session";

// The forums with a thread the signed-in viewer has not read, for the forum cards; empty for a
// guest, who is not asked. One read for the whole tree.
export async function unreadForums(): Promise<ReadonlySet<number>> {
  const { user } = await getViewer();
  if (!user) return new Set();
  const { nodeIds } = await read(nodesUnread, {});
  return new Set(nodeIds);
}
