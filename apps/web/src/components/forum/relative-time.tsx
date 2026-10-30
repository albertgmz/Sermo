import { useNow, useTranslations } from "next-intl";
import { LiveAge } from "@/components/forum/live-age";
import { TimeFrame } from "@/components/forum/relative-time-static";

/**
 * Every past moment the forum shows: an age up to three days ("5 minutes ago", "yesterday"), then
 * the date. The full date and time are in the tooltip and in `dateTime`. The text follows the
 * clock, one step a minute. A route with no client code of its own uses `StaticRelativeTime`.
 */
export function RelativeTime({
  date,
  className,
}: {
  date: string;
  className?: string;
}) {
  const t = useTranslations("forum.relativeTime");
  // Keep this component below the caller's request-time data read.
  const now = useNow();

  return (
    <TimeFrame date={date} className={className}>
      <LiveAge date={date} now={now.getTime()} justNow={t("justNow")} />
    </TimeFrame>
  );
}
