import { standingsMonth } from "@sermo/core/contracts";
import { getFormatter, getTranslations } from "next-intl/server";
import { monthHref } from "@/app/[locale]/(main)/members/month-page";
import { SectionCard } from "@/components/forum/section-card";
import { MemberListSkeleton } from "@/components/forum/skeletons";
import { monthLabel, StandingList } from "@/components/forum/standing";
import {
  MonthPicker,
  monthValue,
  pickableMonths,
} from "@/components/widgets/month-picker";
import { ViewAllLink } from "@/components/widgets/view-all-link";
import type { WidgetBodyProps } from "@/components/widgets/widget-types";
import { readIfAllowed } from "@/lib/sermo/client";
import { getViewer } from "@/lib/sermo/session";

// The members with the most points this month; on the first hours of a month, before anyone has
// any, last month's. Under the list, how the points are counted, and with `picker` a field to ask
// for another month. Nothing for a viewer who may not list members.
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
  const [t, format] = await Promise.all([
    getTranslations("widgetTypes.monthStandings"),
    getFormatter(),
  ]);
  // The field offers the months whose whole standing is kept; the page it leads to offers more.
  const range = pickableMonths([], new Date());
  return (
    <SectionCard
      title={title}
      description={monthLabel(format, standing)}
      action={
        <ViewAllLink
          href={monthHref(monthValue(standing.year, standing.month))}
        >
          {t("viewAll")}
        </ViewAllLink>
      }
    >
      {standing.items.length > 0 ? (
        <StandingList entries={standing.items} viewerId={user?.id} compact />
      ) : (
        <p className="px-4 py-3 text-sm text-muted-foreground">{t("empty")}</p>
      )}
      <p className="px-4 py-2.5 text-xs text-pretty text-muted-foreground">
        {t("scoring", standing.scoring)}
      </p>
      {picker && (
        <MonthPicker
          id={`widget-${widget.id}-month`}
          value={monthValue(standing.year, standing.month)}
          min={range.min}
          max={range.max}
          className="px-4 py-3"
        />
      )}
    </SectionCard>
  );
}

export function MonthStandingsSkeleton({
  widget,
}: {
  widget: WidgetBodyProps<"monthStandings">["widget"];
}) {
  return <MemberListSkeleton rows={widget.options.limit} />;
}
