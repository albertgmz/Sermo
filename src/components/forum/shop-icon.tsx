import {
  Frame,
  Image,
  KeyRound,
  type LucideIcon,
  Palette,
  Zap,
} from "lucide-react";
import { LitePlaceholder } from "@/components/forum/lite-placeholder";
import { liteBlocks } from "@/lib/lite-mode";
import type { ShopCategory } from "@/lib/types";
import { cn } from "@/lib/utils";

const ICONS: Record<ShopCategory, LucideIcon> = {
  frame: Frame,
  color: Palette,
  threadCover: Image,
  boost: Zap,
  permission: KeyRound,
};

export async function ShopIcon({
  category,
  className,
}: {
  category: ShopCategory;
  className?: string;
}) {
  if (await liteBlocks("shop"))
    return (
      <LitePlaceholder
        compact
        className={cn("inline-flex size-6", className)}
      />
    );
  const Icon = ICONS[category];
  return <Icon className={className} aria-hidden="true" />;
}
