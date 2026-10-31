import type { Ctx } from "../../context";
import { prepared } from "../../context";
import { staffGroupIds } from "../../permissions/check";
import { notificationTypes } from "./types";

/**
 * The notices that go to staff for their duties (reports, content to approve, sign-ups to
 * decide): a device login, which holds no staff power, neither lists nor counts them, nor changes
 * how they are sent.
 */
export const STAFF_NOTIFICATION_TYPES: readonly string[] = notificationTypes
  .filter((type) => type.recipient === "moderator")
  .map((type) => type.id);

const STAFF_TYPES_JSON = JSON.stringify(STAFF_NOTIFICATION_TYPES);

/**
 * The notices a device login does not see (`n.` is the notifications row): the staff notices, and
 * the announcements to a staff group. ?3 is the staff notice types, ?4 the staff group ids.
 */
const HIDDEN =
  "(n.type IN (SELECT value FROM json_each(?3)) OR (n.type = 'announcement' AND EXISTS " +
  "(SELECT 1 FROM announcements a WHERE a.id = n.content_id AND a.audience = 'group' AND a.audience_group_id IN (SELECT value FROM json_each(?4)))))";

export const hiddenSql = {
  /** The unread ones of the current epoch updated after ?2 (0 for all): the unread-only index. */
  unread:
    "SELECT count(*) AS n FROM notifications n INDEXED BY notifications_user_unread_recent " +
    "WHERE n.user_id = ?1 AND n.epoch = (SELECT notification_epoch FROM users WHERE id = ?1) " +
    `AND n.updated_at > ?2 AND n.read_at IS NULL AND ${HIDDEN}`,
  /** All of them, read or not (?2 is unused): the member's range of the recent index. */
  all: `SELECT count(*) AS n FROM notifications n INDEXED BY notifications_user_recent WHERE n.user_id = ?1 AND ?2 = ?2 AND ${HIDDEN}`,
};

/** How many of the member's notices a device login does not see: unread ones since `since`, or all. */
export function hiddenFromDeviceLogin(
  ctx: Ctx,
  userId: number,
  which: { unreadSince: number } | "all",
): number {
  const sql = which === "all" ? hiddenSql.all : hiddenSql.unread;
  return prepared(ctx, `notifications.hidden.${which === "all" ? "all" : "unread"}`, () =>
    ctx.sqlite.prepare<{ n: number }, [number, number, string, string]>(sql),
  ).get(userId, which === "all" ? 0 : which.unreadSince, STAFF_TYPES_JSON, staffGroupJson(ctx))!.n;
}

/** The staff group ids as a JSON array (the ?4 parameter of `hiddenSql`). */
export function staffGroupJson(ctx: Ctx): string {
  return JSON.stringify([...staffGroupIds(ctx)]);
}
