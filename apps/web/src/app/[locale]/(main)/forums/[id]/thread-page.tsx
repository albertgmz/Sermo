import { threadsList } from "@sermo/core/contracts";
import { ThreadRow } from "@/app/[locale]/(main)/forums/[id]/thread-row";
import type { ListPage } from "@/lib/list-pages";
import { read } from "@/lib/sermo/client";
import { membersFor } from "@/lib/sermo/members";
import { threadMembers } from "@/lib/sermo/threads";

// One page of a forum's threads, drawn: the forum page's first page (the sticky threads come first
// on it) and each page the browser asks for.
export async function threadsPage(
  nodeId: number,
  prefixId: number | undefined,
  cursor?: string,
  reader: typeof read = read,
): Promise<ListPage> {
  const list = await reader(threadsList, { nodeId, prefixId, cursor });
  const threads = [...list.sticky, ...list.items];
  const member = await membersFor(threads.flatMap(threadMembers));
  const now = Date.now();
  return {
    nextCursor: list.nextCursor,
    rows: threads.map((thread) => ({
      key: String(thread.id),
      node: (
        <ThreadRow
          thread={thread}
          member={member}
          highlighted={
            thread.highlightedUntil !== null &&
            Date.parse(thread.highlightedUntil) > now
          }
        />
      ),
    })),
  };
}
