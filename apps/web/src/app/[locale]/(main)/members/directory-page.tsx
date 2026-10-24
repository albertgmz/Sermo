import { usersList } from "@sermo/core/contracts";
import { MEMBERS_PATH } from "@/app/[locale]/(main)/members/ranking-page";
import type { MemberSort } from "@/app/[locale]/(main)/members/views";
import { MemberCard } from "@/components/forum/member-card";
import { NumberedList } from "@/components/forum/numbered-list";
import { pagesOf } from "@/components/forum/page-window";
import type { ListRow } from "@/lib/list-pages";
import { read } from "@/lib/sermo/client";
import { MEMBERS_PER_PAGE } from "@/lib/sermo/page-sizes";

export type DirectoryPage = { rows: ListRow[]; total: number };

// One numbered page of the member directory, drawn, with how many members the directory holds for
// the viewer. The cards are a grid, so the page is one row of the list, a grid of its own.
export async function directoryPage(
  sort: MemberSort,
  page: number,
  reader: typeof read = read,
): Promise<DirectoryPage> {
  const { items, total } = await reader(usersList, { sort, page });
  return {
    total: total ?? 0,
    rows: [
      {
        key: `cards:${page}`,
        node: (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => (
              <MemberCard key={item.card.id} user={item} />
            ))}
          </div>
        ),
      },
    ],
  };
}

// The directory's parameters: its view, and the sort when it is not the default (`newest`).
export function directoryParams(sort: MemberSort) {
  return { view: "all", sort: sort === "newest" ? undefined : sort };
}

// The part of the directory that turns with its pages (`PageSwitch`): the pagers and the cards.
export function DirectoryPages({
  sort,
  page,
  list,
}: {
  sort: MemberSort;
  page: number;
  list: DirectoryPage;
}) {
  return (
    <NumberedList
      page={page}
      pages={pagesOf(list.total, MEMBERS_PER_PAGE)}
      path={MEMBERS_PATH}
      params={directoryParams(sort)}
      rows={list.rows}
    />
  );
}
