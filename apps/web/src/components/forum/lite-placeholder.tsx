import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export function LitePlaceholder({
  className,
  compact = false,
}: {
  className?: string;
  // Too small for the word, which only screen readers then get; `below-md` for a box that is small
  // on a phone only (an avatar of 24 px growing to 40 px).
  compact?: boolean | "below-md";
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
      <span
        className={
          compact === "below-md" ? "max-md:sr-only" : compact ? "sr-only" : ""
        }
      >
        {t("label")}
      </span>
    </span>
  );
}
