import "server-only";

import { usersActivity } from "@sermo/core/contracts";
import { call } from "./client";
import { SermoError } from "./errors";
import type { ActivityView } from "./views";

// The most members one `users.activity` read takes.
const BATCH = 100;

// When each of a screen's members was last active and, within the hour, which page they viewed,
// in one read per hundred members. A member the viewer may not know about is absent. The place
// only adds to a line the screen draws anyway, so a failed read is logged and leaves every
// member absent rather than failing the screen.
export async function activitiesFor(
  ids: Iterable<number>,
): Promise<ReadonlyMap<number, ActivityView>> {
  const unique = [...new Set(ids)];
  const found = new Map<number, ActivityView>();
  try {
    const pages = await Promise.all(
      Array.from({ length: Math.ceil(unique.length / BATCH) }, (_, index) =>
        call(usersActivity, {
          userIds: unique.slice(index * BATCH, (index + 1) * BATCH),
        }),
      ),
    );
    for (const { items } of pages)
      for (const { userId, activity } of items) found.set(userId, activity);
  } catch (error) {
    if (!(error instanceof SermoError)) throw error;
    console.error(
      "The members' activity could not be read from the API",
      error,
    );
  }
  return found;
}
