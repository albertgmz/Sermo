import { Heart, type LucideIcon, MessageCircle } from "lucide-react";
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
  return (
    <span title={label} className="inline-flex items-center gap-1">
      <Icon aria-hidden="true" className="size-3.5" />
      <span className="sr-only">{label}: </span>
      {formatCompact(value)}
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
      <Count icon={MessageCircle} label="Messages" value={user.postCount} />
      <Count
        icon={Heart}
        label="Reactions received"
        value={user.reactionCount}
      />
    </div>
  );
}
