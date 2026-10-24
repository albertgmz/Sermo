import { threadsList } from "@sermo/core/contracts";
import { ThreadRow } from "@/app/[locale]/(main)/forums/[id]/thread-row";
import { NumberedList } from "@/components/forum/numbered-list";
import { pagesOf } from "@/components/forum/page-window";
import type { ListRow } from "@/lib/list-pages";
import { read } from "@/lib/sermo/client";
import { membersFor } from "@/lib/sermo/members";
import { THREADS_PER_PAGE } from "@/lib/sermo/page-sizes";
import { getViewer } from "@/lib/sermo/session";
import { threadMembers } from "@/lib/sermo/threads";

export type ThreadsPage = { rows: ListRow[]; total: number };

// One numbered page of a forum's threads, drawn: the sticky threads first on page 1, then the page's
// threads, and how many threads the list holds (sticky ones aside), which numbers its pages.
export async function threadsPage(
  nodeId: number,
  prefixId: number | undefined,
  page: number,
  reader: typeof read = read,
): Promise<ThreadsPage> {
  const [list, viewer] = await Promise.all([
    reader(threadsList, { nodeId, prefixId, page }),
    getViewer(),
  ]);
  const threads = [...list.sticky, ...list.items];
  const member = await membersFor(threads.flatMap(threadMembers));
  const now = Date.now();
  return {
    total: list.total ?? 0,
    rows: threads.map((thread) => ({
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
        />
      ),
    })),
  };
}

// The address of a forum's list: the forum, and the prefix it is narrowed to.
export function forumListAddress(nodeId: number, prefixId: number | undefined) {
  return {
    path: `/forums/${nodeId}`,
    params: { prefix: prefixId === undefined ? undefined : String(prefixId) },
  };
}

// The part of the forum page that turns with its pages (`PageSwitch`): the pagers and the threads.
export function ForumThreadPages({
  nodeId,
  prefixId,
  page,
  list,
}: {
  nodeId: number;
  prefixId: number | undefined;
  page: number;
  list: ThreadsPage;
}) {
  return (
    <NumberedList
      page={page}
      pages={pagesOf(list.total, THREADS_PER_PAGE)}
      {...forumListAddress(nodeId, prefixId)}
      rows={list.rows}
      className="overflow-hidden rounded-lg border bg-card"
    />
  );
}
