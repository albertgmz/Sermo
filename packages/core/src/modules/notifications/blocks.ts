import { type Ctx, prepared } from "../../context";
import { OFFICIAL_TYPES } from "./types";

export const noticeBlockSql = {
  // The member's unread notices of the current epoch that a block now leaves out of their list:
  // every actor is a member hidden from them (?5) and the other member is one of them, or they
  // are about a thread the other member started. Official notices stay unread.
  readFrom:
    "UPDATE notifications INDEXED BY notifications_user_unread_recent SET read_at = ?1 " +
    "WHERE user_id = ?2 AND epoch = (SELECT notification_epoch FROM users WHERE id = ?2) AND read_at IS NULL " +
    "AND type NOT IN (SELECT value FROM json_each(?4)) " +
    "AND ((EXISTS (SELECT 1 FROM json_each(notifications.actor_ids) a WHERE a.value = ?3) " +
    "AND NOT EXISTS (SELECT 1 FROM json_each(notifications.actor_ids) j WHERE j.value NOT IN (SELECT value FROM json_each(?5)))) " +
    "OR EXISTS (SELECT 1 FROM threads t WHERE t.id = notifications.thread_id AND t.user_id = ?3))",
  countDown:
    "UPDATE users SET unread_notification_count = max(0, unread_notification_count - ?1) WHERE id = ?2",
} as const;

/**
 * Marks read the unread notices of `userId` that a block with `otherId` leaves out of their list
 * (`hidden`: every member hidden from them now, `otherId` included), and lowers their unread
 * counter to match, so the badge never counts what the list does not show. An unblock shows them
 * again, read. Inside the block's write transaction.
 */
export function readNoticesFrom(ctx: Ctx, userId: number, otherId: number, hidden: number[]): void {
  const changed = prepared(ctx, "notifications.blocks.readFrom", () =>
    ctx.sqlite.prepare<unknown, [number, number, number, string, string]>(noticeBlockSql.readFrom),
  ).run(
    ctx.now(),
    userId,
    otherId,
    JSON.stringify([...OFFICIAL_TYPES]),
    JSON.stringify(hidden),
  ).changes;
  if (changed)
    prepared(ctx, "notifications.blocks.countDown", () =>
      ctx.sqlite.prepare<unknown, [number, number]>(noticeBlockSql.countDown),
    ).run(changed, userId);
}
