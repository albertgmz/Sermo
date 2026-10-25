import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

// Says a thread, forum or profile is marked +18: a small mark beside its title or name, drawn only
// while the site's +18 mode is on (`adultMarked`). Viewers who may not see such content are never
// sent it, so whoever sees the mark may open what it marks. The name is read out in full; the
// figure alone is drawn.
export function AdultBadge({ className }: { className?: string }) {
  const t = useTranslations("forum.adultBadge");
  return (
    <span
      title={t("name")}
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-full border border-destructive/60 px-1.5 text-(length:--text-caption) leading-none font-semibold whitespace-nowrap text-destructive tabular-nums",
        className,
      )}
    >
      <span aria-hidden="true">{t("label")}</span>
      <span className="sr-only">{t("name")}</span>
    </span>
  );
}

// Whether an item carries the +18 mark as the site shows it: never while the mode is off, when the
// marks are kept and change nothing.
export const adultMarked = (adultMode: boolean, ...marks: boolean[]) =>
  adultMode && marks.some(Boolean);
