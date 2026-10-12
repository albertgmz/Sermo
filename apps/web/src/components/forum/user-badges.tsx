import type { MemberView } from "@/lib/sermo/views";
import { cn } from "@/lib/utils";

export type MemberBadgeView = MemberView["badges"][number];

export function MemberBadge({
  badge,
  className,
}: {
  badge: MemberBadgeView;
  className?: string;
}) {
  return (
    <span
      style={
        badge.color
          ? ({ "--badge-color": badge.color } as React.CSSProperties)
          : undefined
      }
      className={cn(
        "inline-flex h-4 shrink-0 items-center rounded-sm border px-1 text-(length:--text-tiny) leading-none font-semibold tracking-wide whitespace-nowrap uppercase",
        badge.color ? "text-(--badge-color)" : "text-muted-foreground",
        className,
      )}
    >
      {badge.label}
    </span>
  );
}

// The group badges of a member, in the order they read next to a name.
export function UserBadges({ user }: { user: Pick<MemberView, "badges"> }) {
  return user.badges.map((badge) => (
    <MemberBadge key={badge.label} badge={badge} />
  ));
}
