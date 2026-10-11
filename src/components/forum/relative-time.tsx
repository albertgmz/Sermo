import { formatDateTime, formatRelativeTime } from "@/lib/format";

export function RelativeTime({
  date,
  className,
}: {
  date: string;
  className?: string;
}) {
  return (
    <time dateTime={date} title={formatDateTime(date)} className={className}>
      {formatRelativeTime(date)}
    </time>
  );
}
