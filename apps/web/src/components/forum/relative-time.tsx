import { useNow, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { LiveAge } from "@/components/forum/live-age";
import { TimeFrame } from "@/components/forum/relative-time-static";

/**
 * Every past moment the forum shows: an age up to three days ("5 minutes ago", "yesterday"), then
 * the date. The full date and time are in the tooltip and in `dateTime`. The text follows the
 * clock, one step a minute. A route with no client code of its own uses `StaticRelativeTime`.
 * `children` are the words a sentence needs before a date ("on ", "el "), written in the message
 * as `<time>on </time>`; they show when the moment reads as a date and not as an age.
 */
export function RelativeTime({
  date,
  className,
  children,
}: {
  date: string;
  className?: string;
  children?: ReactNode;
}) {
  const t = useTranslations("forum.relativeTime");
  // Keep this component below the caller's request-time data read.
  const now = useNow();

  return (
    <TimeFrame date={date} className={className}>
      <LiveAge
        date={date}
        now={now.getTime()}
        justNow={t("justNow")}
        before={children}
      />
    </TimeFrame>
  );
}
