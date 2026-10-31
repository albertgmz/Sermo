import { notificationTypes } from "./types";

/**
 * The notices that go to staff for their duties (reports, content to approve, sign-ups to
 * decide): a device login, which holds no staff power, neither lists nor counts them.
 */
export const STAFF_NOTIFICATION_TYPES: readonly string[] = notificationTypes
  .filter((type) => type.recipient === "moderator")
  .map((type) => type.id);

/** The JSON parameter of `staffUnreadSql`. */
export const STAFF_TYPES_JSON = JSON.stringify(STAFF_NOTIFICATION_TYPES);

/**
 * The member's unread staff notices of the current epoch updated after ?2 (0 for all), at most
 * 100: a range of the unread-only index. ?3 is `STAFF_TYPES_JSON`.
 */
export const staffUnreadSql =
  "SELECT count(*) AS n FROM (SELECT 1 FROM notifications n INDEXED BY notifications_user_unread_recent " +
  "WHERE n.user_id = ?1 AND n.epoch = (SELECT notification_epoch FROM users WHERE id = ?1) " +
  "AND n.updated_at > ?2 AND n.read_at IS NULL AND n.type IN (SELECT value FROM json_each(?3)) LIMIT 100)";
