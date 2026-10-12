import {
  AtSign,
  Award,
  Image,
  type LucideIcon,
  Signature,
  Tag,
} from "lucide-react";

const ICONS = {
  signature: Signature,
  image: Image,
  tag: Tag,
  award: Award,
  "at-sign": AtSign,
} satisfies Record<string, LucideIcon>;

export type PermissionIconKey = keyof typeof ICONS;

export function PermissionIcon({
  permission,
  className,
}: {
  permission: { icon: PermissionIconKey };
  className?: string;
}) {
  const Icon = ICONS[permission.icon];
  return <Icon className={className} aria-hidden="true" />;
}
