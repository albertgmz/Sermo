import type { AwardTier } from "@/lib/types";

export const TIER_ORDER: AwardTier[] = [
  "legendary",
  "gold",
  "silver",
  "bronze",
];

export const TIERS: Record<
  AwardTier,
  { label: string; text: string; dot: string }
> = {
  legendary: {
    label: "Legendary",
    text: "text-tier-legendary",
    dot: "bg-tier-legendary",
  },
  gold: { label: "Gold", text: "text-tier-gold", dot: "bg-tier-gold" },
  silver: { label: "Silver", text: "text-tier-silver", dot: "bg-tier-silver" },
  bronze: { label: "Bronze", text: "text-tier-bronze", dot: "bg-tier-bronze" },
};
