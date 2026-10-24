import { tagsThreads } from "@sermo/core/contracts";
import { ThreadRow } from "@/app/[locale]/(main)/forums/[id]/thread-row";
import type { ListPage } from "@/lib/list-pages";
import { read } from "@/lib/sermo/client";
import { membersFor } from "@/lib/sermo/members";
import { getViewer } from "@/lib/sermo/session";
import { threadMembers } from "@/lib/sermo/threads";

// One page of the threads carrying a tag, drawn: the tag page's first page and each page the
// browser asks for. The rows are those of a forum's list.
export async function tagThreadsPage(
  name: string,
  cursor?: string,
  reader: typeof read = read,
): Promise<ListPage> {
  const [list, viewer] = await Promise.all([
    reader(tagsThreads, { name, cursor }),
    getViewer(),
  ]);
  const member = await membersFor(list.items.flatMap(threadMembers));
  const now = Date.now();
  return {
    nextCursor: list.nextCursor,
    rows: list.items.map((thread) => ({
      key: String(thread.id),
      node: (
        <ThreadRow
          thread={thread}
          member={member}
          signedIn={viewer.user !== null}
          highlighted={
            thread.highlightedUntil !== null &&
            Date.parse(thread.highlightedUntil) > now
          }
          showForum
        />
      ),
    })),
  };
}
