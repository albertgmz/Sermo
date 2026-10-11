import {
  AtSign,
  Award,
  Image,
  type LucideIcon,
  Signature,
  Tag,
} from "lucide-react";
import type { Permission } from "@/lib/permissions";

const ICONS: Record<Permission["icon"], LucideIcon> = {
  signature: Signature,
  image: Image,
  tag: Tag,
  award: Award,
  "at-sign": AtSign,
};

export function PermissionIcon({
  permission,
  className,
}: {
  permission: Pick<Permission, "icon">;
  className?: string;
}) {
  const Icon = ICONS[permission.icon];
  return <Icon className={className} aria-hidden="true" />;
}
