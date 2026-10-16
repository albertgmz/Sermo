import { ChartBar, ListChecks } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

// Says a thread carries a poll or a quiz: a small mark on a thread's card or row. The backend
// answers the kind with the thread, so a list of cards costs no request of its own.
export function PollBadge({
  kind,
  className,
}: {
  kind: "poll" | "quiz";
  className?: string;
}) {
  const t = useTranslations("forum.pollBadge");
  const Icon = kind === "quiz" ? ListChecks : ChartBar;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 text-(length:--text-caption) font-medium whitespace-nowrap text-muted-foreground",
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3" />
      {t(kind)}
    </span>
  );
}
