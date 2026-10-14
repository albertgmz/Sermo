import { Coins } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export function Credits({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  const locale = useLocale();
  const t = useTranslations("forum.credits");
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 font-bold tabular-nums",
        className,
      )}
    >
      <Coins aria-hidden="true" className="size-[1em] shrink-0 text-primary" />
      {formatNumber(value, locale)}
      <span className="sr-only"> {t("aria.unit")}</span>
    </span>
  );
}
