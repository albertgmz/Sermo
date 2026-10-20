import type { AwardTier } from "@/components/forum/award-icon";

// The text colour of an award's rarity (its tier), as its round icon draws it. The tier is never
// named to visitors: awards are grouped by category (`catalogue.ts`).
export const TIERS: Record<AwardTier, { text: string }> = {
  legendary: { text: "text-tier-legendary" },
  gold: { text: "text-tier-gold" },
  silver: { text: "text-tier-silver" },
  bronze: { text: "text-tier-bronze" },
};
