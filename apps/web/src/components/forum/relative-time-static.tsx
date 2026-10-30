import { useFormatter, useLocale, useNow, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { formatPast, inDateBand } from "@/lib/format";

// The `<time>` of a past moment: ISO in `dateTime`, the full date and time in the tooltip.
export function TimeFrame({
  date,
  className,
  children,
}: {
  date: string;
  className?: string;
  children: ReactNode;
}) {
  const t = useTranslations("forum.relativeTime");
  const format = useFormatter();
  const value = new Date(date);

  return (
    <time
      dateTime={date}
      title={t("title", {
        date: format.dateTime(value, { dateStyle: "medium" }),
        time: format.dateTime(value, { timeStyle: "short" }),
      })}
      className={className}
    >
      {children}
    </time>
  );
}

/**
 * `RelativeTime` without the live update, drawn on the server only and with the same text. For a
 * route that holds no client code of its own (the account area, whose script budget is full): the
 * text is as old as the page. `children` are drawn ahead of a date only, as in `RelativeTime`.
 */
export function StaticRelativeTime({
  date,
  className,
  children,
}: {
  date: string;
  className?: string;
  children?: ReactNode;
}) {
  const t = useTranslations("forum.relativeTime");
  const locale = useLocale();
  // Keep this component below the caller's request-time data read.
  const now = useNow();

  return (
    <TimeFrame date={date} className={className}>
      {inDateBand(date, now) && children}
      {formatPast(date, now, locale, t("justNow"))}
    </TimeFrame>
  );
}
