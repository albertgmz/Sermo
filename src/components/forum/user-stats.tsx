import { Heart, type LucideIcon, MessageCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { LevelBadge, XpBar } from "@/components/forum/level";
import type { UserView } from "@/lib/db";
import { formatCompact } from "@/lib/format";
import { cn } from "@/lib/utils";

function Count({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
}) {
  const t = useTranslations("forum.userStats");
  return (
    <span title={label} className="inline-flex items-center gap-1">
      <Icon aria-hidden="true" className="size-3.5" />
      {t.rich("summary", {
        label: (chunks) => <span className="sr-only">{chunks}</span>,
        labelText: label,
        value: formatCompact(value),
      })}
    </span>
  );
}

export function UserStats({
  user,
  className,
}: {
  user: Pick<UserView, "level" | "postCount" | "reactionCount">;
  className?: string;
}) {
  const t = useTranslations("forum.userStats");
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-muted-foreground",
        className,
      )}
    >
      <div className="inline-flex items-center gap-1.5">
        <LevelBadge level={user.level} />
        <XpBar level={user.level} className="w-10" />
      </div>
      <Count icon={MessageCircle} label={t("messagesLabel")} value={user.postCount} />
      <Count
        icon={Heart}
        label={t("reactionsLabel")}
        value={user.reactionCount}
      />
    </div>
  );
}
