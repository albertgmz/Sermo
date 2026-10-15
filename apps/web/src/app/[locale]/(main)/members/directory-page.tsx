import { usersList } from "@sermo/core/contracts";
import type { MemberSort } from "@/app/[locale]/(main)/members/views";
import { MemberCard } from "@/components/forum/member-card";
import type { ListPage } from "@/lib/list-pages";
import { read } from "@/lib/sermo/client";

// One page of the member directory, drawn: the list's first page and each page the browser asks
// for. The cards are a grid, so the page is one row of the list, a grid of its own.
export async function directoryPage(
  sort: MemberSort,
  cursor?: string,
  reader: typeof read = read,
): Promise<ListPage> {
  const { items, nextCursor } = await reader(usersList, { sort, cursor });
  return {
    nextCursor,
    rows: [
      {
        key: `cards:${cursor ?? "first"}`,
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
