import type { ShopEffect } from "@sermo/core/contracts";
import {
  ArrowUpToLine,
  Crown,
  Frame,
  Highlighter,
  Image,
  KeyRound,
  type LucideIcon,
  Palette,
  Smile,
  UserPen,
} from "lucide-react";
import type * as z from "zod";
import { LitePlaceholder } from "@/components/forum/lite-placeholder";
import { liteBlocks } from "@/lib/lite-mode";
import { cn } from "@/lib/utils";

export type ShopEffectType = z.output<typeof ShopEffect>["type"];

// The glyph that stands in for an item without a picture: one per effect the backend knows.
export const SHOP_EFFECT_TYPES = [
  "permission",
  "group",
  "frame",
  "nameColor",
  "nameIcon",
  "threadCover",
  "highlight",
  "bump",
  "usernameChange",
] as const satisfies readonly ShopEffectType[];

const ICONS: Record<ShopEffectType, LucideIcon> = {
  permission: KeyRound,
  group: Crown,
  frame: Frame,
  nameColor: Palette,
  nameIcon: Smile,
  threadCover: Image,
  highlight: Highlighter,
  bump: ArrowUpToLine,
  usernameChange: UserPen,
};

export async function ShopIcon({
  type,
  className,
}: {
  type: ShopEffectType;
  className?: string;
}) {
  if (await liteBlocks("shop"))
    return (
      <LitePlaceholder
        compact
        className={cn("inline-flex size-6", className)}
      />
    );
  const Icon = ICONS[type];
  return <Icon className={className} aria-hidden="true" />;
}
