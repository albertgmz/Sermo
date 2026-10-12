import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { User } from "@/lib/types";
import { cn } from "@/lib/utils";

const ROLES = {
  admin: { variant: "default" },
  moderator: { variant: "success" },
} as const;

export function RoleBadge({
  user,
  className,
}: {
  user: Pick<User, "role">;
  className?: string;
}) {
  const t = useTranslations("forum.roleBadge");
  if (user.role === "member") return null;
  const { variant } = ROLES[user.role];
  return (
    <Badge
      variant={variant}
      className={cn("h-4 px-1.5 text-(length:--text-tiny)", className)}
    >
      {t(user.role)}
    </Badge>
  );
}
