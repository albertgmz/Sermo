import { Megaphone, Star } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

// Why a thread is featured: "Featured" for a staff pick, "Promoted" for a paid promotion.
export function FeatureMark({
  kind,
  className,
}: {
  kind: "staff" | "paid";
  className?: string;
}) {
  const t = useTranslations("forum.featureMark");
  const Icon = kind === "paid" ? Megaphone : Star;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-medium text-primary-ink",
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3" />
      {t(kind === "paid" ? "promoted" : "featured")}
    </span>
  );
}
