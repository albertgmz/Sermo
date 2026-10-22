import { StandingMonth, standingsMonth } from "@sermo/core/contracts";
import {
  numberedCursor,
  readNumbered,
} from "@/app/[locale]/(main)/members/numbered-cursor";
import { viewHref } from "@/app/[locale]/(main)/members/views";
import { StandingRow } from "@/components/forum/standing";
import type { ListPage } from "@/lib/list-pages";
import { read } from "@/lib/sermo/client";
import { getViewer } from "@/lib/sermo/session";

// The month an address or an action names: `YYYY-MM` (or `current`), else none, which is the last
// complete month. The backend refuses a month that has not begun.
export function monthParam(raw: unknown): string | undefined {
  return StandingMonth.safeParse(raw).data;
}

// The address of the standing of `month` from its first page: the plain view for the default month.
export const monthHref = (month?: string) =>
  month === undefined
    ? viewHref("month")
    : `/members/month?month=${encodeURIComponent(month)}`;

// One page of the standing of a month (the last complete one unless named), drawn: the list's first
// page and each page the browser asks for. The month the page is of travels with it, for the
// heading of the first.
export async function monthPage(
  numbered?: string,
  month?: string,
  reader: typeof read = read,
): Promise<ListPage & { year: number; month: number }> {
  const { start, cursor } = readNumbered(numbered);
  const [standing, { user }] = await Promise.all([
    reader(standingsMonth, { month: month ?? "previous", cursor }),
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
