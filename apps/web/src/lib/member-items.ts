import type {
  awardsMember,
  profilesGet,
  usersList,
} from "@sermo/core/contracts";
import type * as z from "zod";
import type { LeaderboardMember } from "@/components/forum/leaderboard";
import type { MemberCardUser } from "@/components/forum/member-card";
import { levelWithBounds } from "@/lib/levels";
import { AWARD_SLOTS } from "@/lib/permissions";
import type { MemberView } from "@/lib/sermo/views";

// What the member screens draw, from what the backend answers. The backend's numbers are shown
// as they come; the shapes below only name them the way the shared components do.

export type ApiListItem = z.output<typeof usersList.output>["items"][number];
export type ApiProfile = z.output<typeof profilesGet.output>;
export type ApiHeldAward = z.output<
  typeof awardsMember.output
>["items"][number];

export function leaderboardMember(item: ApiListItem): LeaderboardMember {
  return {
    id: item.card.id,
    member: item.card,
    level: { level: item.card.level },
    xp: item.awardXp,
    credits: item.credits,
    postCount: item.postCount,
    // Reputation: the score of the reactions received.
    reactionCount: item.reactionScore,
    referralCount: item.referralCount,
    awards: { length: item.awardCount },
  };
}

// A list item has no cover, no level bounds and no award list: its card is the plain one.
export function listCard(item: ApiListItem): MemberCardUser {
  return {
    id: item.card.id,
    member: item.card,
    coverPicture: null,
    level: { level: item.card.level },
    awards: [],
    awardCount: item.awardCount,
    awardSlots: AWARD_SLOTS,
    postCount: item.postCount,
    reactionCount: item.reactionScore,
    joinedAt: item.createdAt,
  };
}

export function profileCard(
  profile: ApiProfile,
  held: ApiHeldAward[],
): MemberCardUser {
  const { level } = profile;
  return {
    id: profile.id,
    member: profile.card,
    coverPicture: profile.cover && { url: profile.cover.url },
    level: levelWithBounds(
      level.level,
      profile.awardXp,
      level.currentLevelXp,
      level.nextLevelXp,
    ),
    awards: held.map(({ award }) => award),
    awardSlots: {
      desktop: profile.awardSlots,
      mobile: Math.min(profile.awardSlots, AWARD_SLOTS.mobile),
    },
    postCount: profile.postCount,
    reactionCount: profile.reactionScore,
    joinedAt: profile.createdAt,
  };
}

// A standing entry, also with the month of a winner, in the shape the standing components take.
export function standingEntry<T extends { card: MemberView }>(entry: T) {
  const { card, ...rest } = entry;
  return { ...rest, user: { id: card.id, member: card } };
}
