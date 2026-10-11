import { RoleBadge } from "@/components/forum/role-badge";
import { type AvatarUser, UserAvatar } from "@/components/forum/user-avatar";
import { type LinkUser, UserLink } from "@/components/forum/user-link";
import type { UserView } from "@/lib/db";
import { cn } from "@/lib/utils";

export function MemberRow({
  user,
  children,
  className,
}: {
  user: AvatarUser & LinkUser & Pick<UserView, "title">;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-3 px-4 py-2.5", className)}>
      <UserAvatar user={user} size="lg" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2">
          <UserLink user={user} className="truncate text-sm" />
          <RoleBadge user={user} />
        </p>
        <p className="truncate text-xs text-muted-foreground">{user.title}</p>
      </div>
      {children}
    </div>
  );
}
