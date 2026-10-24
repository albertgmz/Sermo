import { tagsThreads } from "@sermo/core/contracts";
import type { ThreadsPage } from "@/app/[locale]/(main)/forums/[id]/thread-page";
import { ThreadRow } from "@/app/[locale]/(main)/forums/[id]/thread-row";
import { NumberedList } from "@/components/forum/numbered-list";
import { pagesOf } from "@/components/forum/page-window";
import { read } from "@/lib/sermo/client";
import { membersFor } from "@/lib/sermo/members";
import { TAG_THREADS_PER_PAGE } from "@/lib/sermo/page-sizes";
import { getViewer } from "@/lib/sermo/session";
import { tagHref } from "@/lib/sermo/tags";
import { threadMembers } from "@/lib/sermo/threads";

// One numbered page of the threads carrying a tag, drawn, and how many threads its pages hold. The
// rows are those of a forum's list.
export async function tagThreadsPage(
  name: string,
  page: number,
  reader: typeof read = read,
): Promise<ThreadsPage> {
  const [list, viewer] = await Promise.all([
    reader(tagsThreads, { name, page }),
    getViewer(),
  ]);
  const member = await membersFor(list.items.flatMap(threadMembers));
  const now = Date.now();
  return {
    total: list.total ?? 0,
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

// The part of the tag page that turns with its pages (`PageSwitch`): the pagers and the threads.
export function TagThreadPages({
  name,
  page,
  list,
}: {
  name: string;
  page: number;
  list: ThreadsPage;
}) {
  return (
    <NumberedList
      page={page}
      pages={pagesOf(list.total, TAG_THREADS_PER_PAGE)}
      path={tagHref(name)}
      rows={list.rows}
      className="overflow-hidden rounded-lg border bg-card"
    />
  );
}
