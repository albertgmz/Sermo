import { useTranslations } from "next-intl";
import { Progress } from "@/components/ui/progress";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

// A level with the bounds the backend gave for it and how full the bar between them is.
export type Level = {
  level: number;
  xp: number;
  currentLevelXp: number;
  nextLevelXp: number;
  progress: number;
};

// The bounds of a level come from the backend; only the fill of the bar is worked out here.
export function levelWithBounds(
  level: number,
  xp: number,
  currentLevelXp: number,
  nextLevelXp: number,
): Level {
  const span = nextLevelXp - currentLevelXp;
  return {
    level,
    xp,
    currentLevelXp,
    nextLevelXp,
    progress:
      span > 0 ? Math.min(1, Math.max(0, (xp - currentLevelXp) / span)) : 0,
  };
}

export function LevelBadge({
  level,
  className,
}: {
  level: Pick<Level, "level">;
  className?: string;
}) {
  const t = useTranslations("forum.level");
  return (
    <span
      className={cn(
        "inline-flex h-4 shrink-0 items-center gap-0.5 rounded-sm border bg-muted px-1 text-(length:--text-tiny) leading-none font-semibold tracking-wide whitespace-nowrap text-muted-foreground",
        className,
      )}
    >
      {t("badge")}
      <span className="text-foreground tabular-nums">{level.level}</span>
    </span>
  );
}

export function XpBar({
  level,
  label = false,
  className,
}: {
  level: Level;
  label?: boolean;
  className?: string;
}) {
  const t = useTranslations("forum.level");
  const xp = t("xp", { xp: formatNumber(level.xp) });
  return (
    <div className="inline-flex items-center gap-2">
      <Progress
        value={level.progress * 100}
        aria-label={t("aria.progress", {
          level: level.level,
          xp: formatNumber(level.xp),
          next: formatNumber(level.nextLevelXp),
        })}
        className={cn("w-12", className)}
      />
      {label && (
        <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
          {xp}
        </span>
      )}
    </div>
  );
}
