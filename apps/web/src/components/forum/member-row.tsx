import { type AvatarUser, UserAvatar } from "@/components/forum/user-avatar";
import { UserBadges } from "@/components/forum/user-badges";
import { type LinkUser, UserLink } from "@/components/forum/user-link";
import type { MemberView } from "@/lib/sermo/views";
import { cn } from "@/lib/utils";

export function MemberRow({
  user,
  children,
  badgeLimit,
  className,
}: {
  user: AvatarUser & LinkUser & Pick<MemberView, "title" | "badges">;
  children?: React.ReactNode;
  // How many of the member's badges to show; a row shows the staff role alone.
  badgeLimit?: number;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-3 px-4 py-2.5", className)}>
      <UserAvatar user={user} size="lg" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2">
          <UserLink user={user} className="truncate text-sm" />
          <UserBadges user={user} limit={badgeLimit} />
        </p>
        <p className="truncate text-xs text-muted-foreground">{user.title}</p>
      </div>
      {children}
    </div>
  );
}
