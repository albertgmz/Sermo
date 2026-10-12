import { cn } from "@/lib/utils";

export function UnreadDot({ className }: { className?: string }) {
  const t = useTranslations("forum.unreadDot");
  return (
    <span
      className={cn(
        "relative size-2 shrink-0 rounded-full bg-primary",
        className,
      )}
    >
      <span className="sr-only">{t("aria.label")}</span>
    </span>
  );
}
import { useTranslations } from "next-intl";
