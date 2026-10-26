import type { Actor } from "../../actor";
import type { Ctx } from "../../context";
import { mayViewProfile, profileAccessMany } from "../profiles/shared";

/** The one statement of "banned" for the member lists: permanently, or until a time to come. */
export const isBanned = (
  row: { banned_until: number | null; banned_permanently: number },
  now: number,
) => row.banned_permanently === 1 || (row.banned_until !== null && row.banned_until > now);

/**
 * The members of a batch whose profile the viewer may open (themselves always) and that a member
 * list shows them: none in a block with them, either way. One query for the whole batch.
 */
export function openableProfiles(ctx: Ctx, actor: Actor, userIds: number[]): Set<number> {
  const access = profileAccessMany(ctx, actor, userIds);
  return new Set(
    userIds.filter((id) => {
      const row = access.get(id);
      return (
        row !== undefined && row.blocked_by_viewer !== 1 && mayViewProfile(ctx, actor, id, row)
      );
    }),
  );
}
