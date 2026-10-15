import { standingsMonth } from "@sermo/core/contracts";
import {
  numberedCursor,
  readNumbered,
} from "@/app/[locale]/(main)/members/numbered-cursor";
import { StandingRow } from "@/components/forum/standing";
import type { ListPage } from "@/lib/list-pages";
import { read } from "@/lib/sermo/client";
import { getViewer } from "@/lib/sermo/session";

// One page of the last complete month's standing, drawn: the list's first page and each page the
// browser asks for. The month the page is of travels with it, for the heading of the first.
export async function monthPage(
  numbered?: string,
  reader: typeof read = read,
): Promise<ListPage & { year: number; month: number }> {
  const { start, cursor } = readNumbered(numbered);
  const [standing, { user }] = await Promise.all([
    reader(standingsMonth, { month: "previous", cursor }),
    getViewer(),
  ]);
  return {
    year: standing.year,
    month: standing.month,
    nextCursor:
      standing.nextCursor &&
      numberedCursor(start + standing.items.length, standing.nextCursor),
    rows: standing.items.map((entry, index) => ({
      key: String(entry.card.id),
      node: (
        <StandingRow
          entry={entry}
          rank={start + index}
          leader={start === 1 && index === 0}
          viewer={entry.card.id === user?.id}
        />
      ),
    })),
  };
}
