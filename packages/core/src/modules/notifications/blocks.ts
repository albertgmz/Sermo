import { type Ctx, prepared } from "../../context";
import { OFFICIAL_TYPES } from "./types";

export const noticeBlockSql = {
  // The member's unread notices of the current epoch that a block now leaves out of their list:
  // the other member is their only actor, or they are about a thread the other member started.
  // Official notices stay unread.
  readFrom:
    "UPDATE notifications INDEXED BY notifications_user_unread_recent SET read_at = ?1 " +
    "WHERE user_id = ?2 AND epoch = (SELECT notification_epoch FROM users WHERE id = ?2) AND read_at IS NULL " +
    "AND type NOT IN (SELECT value FROM json_each(?4)) " +
    "AND (actor_ids = json_array(?3) OR EXISTS (SELECT 1 FROM threads t WHERE t.id = notifications.thread_id AND t.user_id = ?3))",
  countDown:
    "UPDATE users SET unread_notification_count = max(0, unread_notification_count - ?1) WHERE id = ?2",
} as const;

/**
 * Marks read the unread notices of `userId` that a block with `otherId` leaves out of their list,
 * and lowers their unread counter to match, so the badge never counts what the list does not
 * show. An unblock shows them again, read. Inside the block's write transaction.
 */
export function readNoticesFrom(ctx: Ctx, userId: number, otherId: number): void {
  const changed = prepared(ctx, "notifications.blocks.readFrom", () =>
    ctx.sqlite.prepare<unknown, [number, number, number, string]>(noticeBlockSql.readFrom),
  ).run(ctx.now(), userId, otherId, JSON.stringify([...OFFICIAL_TYPES])).changes;
  if (changed)
    prepared(ctx, "notifications.blocks.countDown", () =>
      ctx.sqlite.prepare<unknown, [number, number]>(noticeBlockSql.countDown),
    ).run(changed, userId);
}
