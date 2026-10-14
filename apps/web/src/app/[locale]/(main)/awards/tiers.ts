import type { AwardTier } from "@/components/forum/award-icon";

export const TIER_ORDER: AwardTier[] = [
  "legendary",
  "gold",
  "silver",
  "bronze",
];

export const TIERS: Record<AwardTier, { text: string; dot: string }> = {
  legendary: {
    text: "text-tier-legendary",
    dot: "bg-tier-legendary",
  },
  gold: { text: "text-tier-gold", dot: "bg-tier-gold" },
  silver: { text: "text-tier-silver", dot: "bg-tier-silver" },
  bronze: { text: "text-tier-bronze", dot: "bg-tier-bronze" },
};
