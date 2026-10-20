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
import { useTranslations } from "next-intl";
import { LitePlaceholder } from "@/components/forum/lite-placeholder";
import { LazyTooltip } from "@/components/ui/lazy-tooltip";
import { liteBlocks } from "@/lib/lite-mode";
import type { AuthorView } from "@/lib/sermo/views";
import { cn } from "@/lib/utils";

export type AwardTier = AuthorView["awards"][number]["tier"];

// Awards shown next to a name: on phones, and from `md` up. A profile says how many slots it has.
export const MOBILE_AWARD_SLOTS = 3;
export const DESKTOP_AWARD_SLOTS = 5;

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

// What an award draws in its round icon: the glyph of its icon key in the colours of its tier.
// Its picture is a wide backdrop for the award's card, never cropped into the circle.
export type AwardArt = {
  name: string;
  icon: string;
  tier: AwardTier;
};

// `label` is what it is called (default: the award's name), e.g. with its category on a profile.
export async function AwardIcon({
  award,
  size = "md",
  label = award.name,
  className,
}: {
  award: AwardArt;
  size?: AwardIconSize;
  label?: string;
  className?: string;
}) {
  const Icon = ICONS[award.icon] ?? AwardFallback;
  const [box, glyph] = SIZES[size];
  const blocked = await liteBlocks("awards");
  return (
    <LazyTooltip
      label={label}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full border",
        TIERS[award.tier],
        box,
        className,
      )}
    >
      {blocked ? (
        <LitePlaceholder compact className={cn("rounded-full", glyph)} />
      ) : (
        <Icon aria-hidden="true" className={glyph} />
      )}
    </LazyTooltip>
  );
}

export function AwardRow({
  awards,
  max = DESKTOP_AWARD_SLOTS,
  maxMobile = MOBILE_AWARD_SLOTS,
  size = "sm",
  className,
}: {
  awards: (AwardArt & { id: number })[];
  max?: number;
  maxMobile?: number;
  size?: AwardIconSize;
  className?: string;
}) {
  const t = useTranslations("forum.awardIcon");
  if (awards.length === 0) return null;
  const overflowClass = "text-(length:--text-caption) font-medium tabular-nums";
  return (
    <Link
      href="/awards"
      aria-label={t("aria.count", { count: awards.length })}
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
