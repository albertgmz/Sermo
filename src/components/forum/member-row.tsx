import { useTranslations } from "next-intl";
import { RoleBadge } from "@/components/forum/role-badge";
import { type AvatarUser, UserAvatar } from "@/components/forum/user-avatar";
import { type LinkUser, UserLink } from "@/components/forum/user-link";
import type { UserView } from "@/lib/db";
import { titleKeyForLevel } from "@/lib/levels";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";

export function MemberRow({
  user,
  children,
  className,
}: {
  user: AvatarUser &
    LinkUser &
    Pick<UserView, "title" | "customTitle" | "permissions" | "level">;
  children?: React.ReactNode;
  className?: string;
}) {
  const tLevels = useTranslations("lib.levels");
  const tRoles = useTranslations("lib.db.roles");
  const title =
    (can(user, "customTitle") && user.customTitle) ||
    (user.role === "member"
      ? tLevels(titleKeyForLevel(user.level.level))
      : tRoles(user.role));
  return (
    <div className={cn("flex items-center gap-3 px-4 py-2.5", className)}>
      <UserAvatar user={user} size="lg" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2">
          <UserLink user={user} className="truncate text-sm" />
          <RoleBadge user={user} />
        </p>
        <p className="truncate text-xs text-muted-foreground">{title}</p>
      </div>
      {children}
    </div>
  );
}
