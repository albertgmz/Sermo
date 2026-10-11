import {
  Frame,
  Image,
  KeyRound,
  type LucideIcon,
  Palette,
  Zap,
} from "lucide-react";
import type { ShopCategory } from "@/lib/types";

const ICONS: Record<ShopCategory, LucideIcon> = {
  frame: Frame,
  color: Palette,
  threadCover: Image,
  boost: Zap,
  permission: KeyRound,
};

export function ShopIcon({
  category,
  className,
}: {
  category: ShopCategory;
  className?: string;
}) {
  const Icon = ICONS[category];
  return <Icon className={className} aria-hidden="true" />;
}
