import { Heart } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { MemberView } from "@/lib/sermo/views";
import { cn } from "@/lib/utils";

export type MemberBadgeView = MemberView["badges"][number];

type BadgeProps = { badge: MemberBadgeView; className?: string };

const tinyClass = "h-4 px-1.5 text-(length:--text-tiny)";

function colorVar(color: string | null) {
  return color
    ? ({ "--badge-color": color } as React.CSSProperties)
    : undefined;
}

// Text that stays readable on a fill of the given colour.
function onFill(color: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const channel = Number.parseInt(color.slice(i, i + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4
    ? "text-background"
    : "text-primary-foreground";
}

function SolidBadge({ badge, className }: BadgeProps) {
  return (
    <Badge
      variant="default"
      style={colorVar(badge.color)}
      className={cn(
        tinyClass,
        badge.color && ["bg-(--badge-color)", onFill(badge.color)],
        className,
      )}
    >
      {badge.label}
    </Badge>
  );
}

function TintBadge({ badge, className }: BadgeProps) {
  return (
    <Badge
      variant="success"
      style={colorVar(badge.color)}
      className={cn(
        tinyClass,
        badge.color && "bg-(--badge-color)/10 text-(--badge-color)",
        className,
      )}
    >
      {badge.label}
    </Badge>
  );
}

function OutlineBadge({ badge, className }: BadgeProps) {
  const t = useTranslations("forum.userBadges.group");
  return (
    <span
      title={t("title", { name: badge.label })}
      style={colorVar(badge.color)}
      className={cn(
        "inline-flex h-4 shrink-0 items-center rounded-sm border px-1 text-(length:--text-tiny) leading-none font-semibold tracking-wide whitespace-nowrap uppercase",
        badge.color ? "text-(--badge-color)" : "text-muted-foreground",
        className,
      )}
    >
      {badge.label}
      <span className="sr-only"> {t("suffix")}</span>
    </span>
  );
}

function HeartBadge({ badge, className }: BadgeProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label={badge.label}
            style={colorVar(badge.color)}
            className={cn(
              "inline-flex size-4 shrink-0 items-center justify-center",
              badge.color ? "text-(--badge-color)" : "text-muted-foreground",
              className,
            )}
          />
        }
      >
        <Heart aria-hidden="true" className="size-3 fill-current" />
      </TooltipTrigger>
      <TooltipContent>{badge.label}</TooltipContent>
    </Tooltip>
  );
}

// The design system's badge styles, by the key a group carries. An unknown or
// empty key draws the outline look.
const BADGE_STYLES: Record<string, (props: BadgeProps) => React.ReactNode> = {
  solid: SolidBadge,
  tint: TintBadge,
  outline: OutlineBadge,
  heart: HeartBadge,
  // The keys the backend gives its built-in staff groups.
  admin: SolidBadge,
  moderator: TintBadge,
};

export function MemberBadge({ badge, className }: BadgeProps) {
  const Style = Object.hasOwn(BADGE_STYLES, badge.style)
    ? BADGE_STYLES[badge.style]
    : OutlineBadge;
  return <Style badge={badge} className={className} />;
}

// The group badges of a member, highest group first; `limit` keeps the first few.
export function UserBadges({
  user,
  limit,
}: {
  user: Pick<MemberView, "badges">;
  limit?: number;
}) {
  return user.badges
    .slice(0, limit)
    .map((badge) => <MemberBadge key={badge.label} badge={badge} />);
}
