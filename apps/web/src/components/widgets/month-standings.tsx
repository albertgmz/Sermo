import { standingsMonth } from "@sermo/core/contracts";
import { getFormatter, getTranslations } from "next-intl/server";
import type * as z from "zod";
import { monthHref } from "@/app/[locale]/(main)/members/month-page";
import { MemberListSkeleton } from "@/components/forum/skeletons";
import { monthLabel, StandingList } from "@/components/forum/standing";
import { monthValue, pickableMonths } from "@/components/widgets/month-range";
import { monthStandingsPart } from "@/components/widgets/month-standings-action";
import {
  type MonthParts,
  MonthStandingsCard,
} from "@/components/widgets/month-standings-card";
import type { WidgetBodyProps } from "@/components/widgets/widget-types";
import { readIfAllowed } from "@/lib/sermo/client";
import { getViewer } from "@/lib/sermo/session";

type Standing = z.output<typeof standingsMonth.output>;

// The part of the card that follows the month shown, as the widget and its picker's action draw it.
export async function monthParts(
  standing: Standing,
  viewerId: number | undefined,
): Promise<MonthParts> {
  const [t, format] = await Promise.all([
    getTranslations("widgetTypes.monthStandings"),
    getFormatter(),
  ]);
  return {
    description: monthLabel(format, standing),
    href: monthHref(monthValue(standing.year, standing.month)),
    body: (
      <>
        {standing.items.length > 0 ? (
          <StandingList entries={standing.items} viewerId={viewerId} compact />
        ) : (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            {t("empty")}
          </p>
        )}
        <p className="px-4 py-2.5 text-xs text-pretty text-muted-foreground">
          {t("scoring", standing.scoring)}
        </p>
      </>
    ),
  };
}

// The members with the most points this month; on the first hours of a month, before anyone has
// any, last month's. Under the list, how the points are counted, and with `picker` a field to ask
// for another month, which draws that month in the card itself (`MonthStandingsCard`). Nothing for
// a viewer who may not list members.
export async function MonthStandings({
  widget,
  title,
}: WidgetBodyProps<"monthStandings">) {
  const { limit, picker } = widget.options;
  const [{ user }, running] = await Promise.all([
    getViewer(),
    readIfAllowed(standingsMonth, { month: "current", limit }),
  ]);
  if (!running) return null;
  // A first page can be empty while the month has rows further on (members hidden from this
  // viewer): only a month with nothing at all gives way to the last one.
  const wholeMonthEmpty = running.items.length === 0 && !running.nextCursor;
  if (running.items.length === 0 && !wholeMonthEmpty) return null;
  const standing = wholeMonthEmpty
    ? ((await readIfAllowed(standingsMonth, { month: "previous", limit })) ??
      running)
    : running;
  const [t, parts] = await Promise.all([
    getTranslations("widgetTypes.monthStandings"),
    monthParts(standing, user?.id),
  ]);
  // The field offers the months whose whole standing is kept; the page it leads to offers more.
  const range = pickableMonths([], new Date());
  return (
    <MonthStandingsCard
      id={`widget-${widget.id}-month`}
      title={title}
      viewAll={t("viewAll")}
      parts={parts}
      month={monthValue(standing.year, standing.month)}
      picker={picker ? { min: range.min, max: range.max } : undefined}
      load={monthStandingsPart.bind(null, limit)}
    />
  );
}

export function MonthStandingsSkeleton({
  widget,
}: {
  widget: WidgetBodyProps<"monthStandings">["widget"];
}) {
  return <MemberListSkeleton rows={widget.options.limit} />;
}
