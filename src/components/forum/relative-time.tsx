import { useFormatter, useNow, useTranslations } from "next-intl";

export function RelativeTime({
  date,
  className,
}: {
  date: string;
  className?: string;
}) {
  const t = useTranslations("forum.relativeTime");
  const format = useFormatter();
  // Keep this component below the caller's request-time data read.
  const now = useNow();
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
      {format.relativeTime(value, now)}
    </time>
  );
}
