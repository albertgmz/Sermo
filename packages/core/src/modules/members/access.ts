import type { Actor } from "../../actor";
import type { Ctx } from "../../context";
import { mayViewProfile, profileAccessMany } from "../profiles/shared";

/** The one statement of "banned" for the member lists: permanently, or until a time to come. */
export const isBanned = (
  row: { banned_until: number | null; banned_permanently: number },
  now: number,
) => row.banned_permanently === 1 || (row.banned_until !== null && row.banned_until > now);

/**
 * The members of a batch whose profile the viewer may open (themselves always), in one query
 * for the whole batch.
 */
export function openableProfiles(ctx: Ctx, actor: Actor, userIds: number[]): Set<number> {
  const access = profileAccessMany(ctx, actor, userIds);
  return new Set(
    userIds.filter((id) => {
      const row = access.get(id);
      return row !== undefined && mayViewProfile(ctx, actor, id, row);
    }),
  );
}
