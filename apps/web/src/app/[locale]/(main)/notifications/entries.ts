import "server-only";

import {
  type ApiNotification,
  hrefOf,
} from "@/app/[locale]/(main)/notifications/href";
import { membersFor } from "@/lib/sermo/members";
import { getReactionTypes } from "@/lib/sermo/reactions";

export type NotificationEntry = {
  item: ApiNotification;
  href: string;
  // The emoji and the title of the reaction a reaction notification is about; empty for the rest.
  emoji: string;
  reaction: string;
};

// Everything a list of notifications needs to be drawn: where each one leads, the reaction's
// emoji and title and the members it names (one batched lookup).
export async function notificationEntries(items: ApiNotification[]) {
  const [types, hrefs, member] = await Promise.all([
    getReactionTypes(),
    Promise.all(items.map(hrefOf)),
    membersFor(items.flatMap((item) => item.actors)),
  ]);
  const entries: NotificationEntry[] = items.map((item, index) => {
    const typeId = item.data.reactionTypeId;
    const type =
      typeof typeId === "number"
        ? types.find((entry) => entry.id === typeId)
        : undefined;
    return {
      item,
      href: hrefs[index],
      emoji: type?.emoji ?? "",
      reaction: type?.title ?? "",
    };
  });
  return { entries, member };
}
