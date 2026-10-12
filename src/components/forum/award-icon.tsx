import {
  Award as AwardFallback,
  BookOpen,
  Bug,
  Crown,
  Flame,
  FlameKindling,
  Gem,
  Handshake,
  Heart,
  LifeBuoy,
  type LucideIcon,
  MessageCircle,
  MessagesSquare,
  Shield,
  Sparkle,
  Star,
  Sunrise,
  Trophy,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { LitePlaceholder } from "@/components/forum/lite-placeholder";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { liteBlocks } from "@/lib/lite-mode";
import { AWARD_SLOTS } from "@/lib/permissions";
import type { Award, AwardTier } from "@/lib/types";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  "book-open": BookOpen,
  bug: Bug,
  crown: Crown,
  flame: Flame,
  "flame-kindling": FlameKindling,
  gem: Gem,
  handshake: Handshake,
  heart: Heart,
  "life-buoy": LifeBuoy,
  "message-circle": MessageCircle,
  "messages-square": MessagesSquare,
  shield: Shield,
  sparkle: Sparkle,
  star: Star,
  sunrise: Sunrise,
  trophy: Trophy,
  zap: Zap,
};

const TIERS: Record<AwardTier, string> = {
  bronze: "border-tier-bronze/40 bg-tier-bronze/15 text-tier-bronze",
  silver: "border-tier-silver/40 bg-tier-silver/15 text-tier-silver",
  gold: "border-tier-gold/40 bg-tier-gold/15 text-tier-gold",
  legendary:
    "border-tier-legendary/50 bg-tier-legendary/15 text-tier-legendary",
};

const SIZES = {
  sm: ["size-5", "size-3"],
  md: ["size-8", "size-4"],
  lg: ["size-12", "size-6"],
};

export type AwardIconSize = keyof typeof SIZES;

export async function AwardIcon({
  award,
  size = "md",
  className,
}: {
  award: Pick<Award, "name" | "icon" | "tier">;
  size?: AwardIconSize;
  className?: string;
}) {
  const Icon = ICONS[award.icon] ?? AwardFallback;
  const [box, glyph] = SIZES[size];
  const blocked = await liteBlocks("awards");
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label={award.name}
            className={cn(
              "inline-flex shrink-0 items-center justify-center rounded-full border",
              TIERS[award.tier],
              box,
              className,
            )}
          />
        }
      >
        {blocked ? (
          <LitePlaceholder compact className={cn("rounded-full", glyph)} />
        ) : (
          <Icon aria-hidden="true" className={glyph} />
        )}
      </TooltipTrigger>
      <TooltipContent>{award.name}</TooltipContent>
    </Tooltip>
  );
}

export function AwardRow({
  awards,
  max = AWARD_SLOTS.desktop,
  maxMobile = AWARD_SLOTS.mobile,
  size = "sm",
  className,
}: {
  awards: (Pick<Award, "name" | "icon" | "tier"> & Pick<Award, "id">)[];
  max?: number;
  maxMobile?: number;
  size?: AwardIconSize;
  className?: string;
}) {
  if (awards.length === 0) return null;
  const overflowClass = "text-(length:--text-caption) font-medium tabular-nums";
  return (
    <Link
      href="/awards"
      aria-label={`${awards.length} ${awards.length === 1 ? "award" : "awards"}`}
      className={cn(
        "relative inline-flex shrink-0 items-center gap-0.5 rounded-full text-muted-foreground transition-colors after:absolute after:-inset-x-1 after:-inset-y-2.5 hover:text-foreground md:after:hidden",
        className,
      )}
    >
      {awards.slice(0, max).map((award, index) => (
        <AwardIcon
          key={award.id}
          award={award}
          size={size}
          className={index >= maxMobile ? "hidden md:inline-flex" : undefined}
        />
      ))}
      {awards.length > maxMobile && (
        <span className={cn(overflowClass, "ml-0.5 md:hidden")}>
          +{awards.length - maxMobile}
        </span>
      )}
      {awards.length > max && (
        <span className={cn(overflowClass, "ml-0.5 hidden md:inline")}>
          +{awards.length - max}
        </span>
      )}
    </Link>
  );
}
