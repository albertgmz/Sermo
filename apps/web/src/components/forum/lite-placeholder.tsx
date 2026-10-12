import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export function LitePlaceholder({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const t = useTranslations("lite.litePlaceholder");
  return (
    <span
      aria-label={t("aria.label")}
      role="img"
      data-slot="lite-placeholder"
      className={cn(
        "pointer-events-none flex items-center justify-center overflow-hidden bg-muted text-center font-mono text-(length:--text-tiny) leading-tight text-muted-foreground",
        className,
      )}
    >
      <span className={compact ? "sr-only" : ""}>{t("label")}</span>
    </span>
  );
}
