import { Badge } from "@/components/ui/badge";
import type { User } from "@/lib/types";
import { cn } from "@/lib/utils";

const ROLES = {
  admin: { label: "Admin", variant: "default" },
  moderator: { label: "Mod", variant: "success" },
} as const;

export function RoleBadge({
  user,
  className,
}: {
  user: Pick<User, "role">;
  className?: string;
}) {
  if (user.role === "member") return null;
  const { label, variant } = ROLES[user.role];
  return (
    <Badge
      variant={variant}
      className={cn("h-4 px-1.5 text-[0.625rem]", className)}
    >
      {label}
    </Badge>
  );
}
