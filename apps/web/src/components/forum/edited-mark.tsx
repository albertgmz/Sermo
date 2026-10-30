import { useTranslations } from "next-intl";
import { RelativeTime } from "@/components/forum/relative-time";
import { cn } from "@/lib/utils";

// "Edited 5 minutes ago", next to the time of a post, message, wall post or comment.
export function EditedMark({
  date,
  className,
}: {
  date: string;
  className?: string;
}) {
  const t = useTranslations("forum.editedMark");
  return (
    <span className={cn("shrink-0", className)}>
      {t.rich("label", {
        time: (chunks) => <RelativeTime date={date}>{chunks}</RelativeTime>,
      })}
    </span>
  );
}
