"use server";

import { usersSearch } from "@sermo/core/contracts";
import { liteBlocks } from "@/lib/lite-mode";
import { call } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";
import { membersFor } from "@/lib/sermo/members";

// A member the "@" list of a composer offers, with what tells them apart: the small avatar (null
// when they have none or the visitor switched avatars off), the name colour, the title under the
// name and whether they are staff (their name is drawn in bold).
export type MentionHit = {
  id: number;
  username: string;
  avatar: string | null;
  nameColor: string | null;
  title: string;
  staff: boolean;
};

// XenForo's mention list offers ten.
const LIMIT = 10;

// The members whose name starts with what is typed after an "@", as they are drawn next to their
// content: one search and one read of their cards.
export async function findMentions(prefix: string): Promise<MentionHit[]> {
  try {
    const { items } = await call(usersSearch, { prefix, limit: LIMIT });
    if (items.length === 0) return [];
    const [member, noAvatars] = await Promise.all([
      membersFor(items),
      liteBlocks("avatars"),
    ]);
    return items.map(({ id, staff }) => {
      const { username, avatar, nameColor, title } = member(id);
      return {
        id,
        username,
        avatar: noAvatars ? null : (avatar?.smallUrl ?? null),
        nameColor,
        title,
        staff,
      };
    });
  } catch (error) {
    if (!(error instanceof SermoError)) throw error;
    return [];
  }
}
