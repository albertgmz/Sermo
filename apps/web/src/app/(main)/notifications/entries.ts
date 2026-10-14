import "server-only";

import { type ApiNotification, hrefOf } from "@/app/(main)/notifications/href";
import { membersFor } from "@/lib/sermo/members";
import { getReactionTypes } from "@/lib/sermo/reactions";

export type NotificationEntry = {
  item: ApiNotification;
  href: string;
  // The emoji of the reaction a reaction notification is about; empty for the rest.
  emoji: string;
};

// Everything a list of notifications needs to be drawn: where each one leads, the reaction's
// emoji and the members it names (one batched lookup).
export async function notificationEntries(items: ApiNotification[]) {
  const [types, hrefs, member] = await Promise.all([
    getReactionTypes(),
    Promise.all(items.map(hrefOf)),
    membersFor(items.flatMap((item) => item.actors)),
  ]);
  const entries: NotificationEntry[] = items.map((item, index) => {
    const typeId = item.data.reactionTypeId;
    return {
      item,
      href: hrefs[index],
      emoji:
        (typeof typeId === "number" &&
          types.find((type) => type.id === typeId)?.emoji) ||
        "",
    };
  });
  return { entries, member };
}
