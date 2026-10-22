import type { Ctx } from "../../context";
import { prepared } from "../../context";
import { publishEvent } from "../../events";
import {
  can,
  currentVersions,
  memberActor,
  PRINCIPAL_COLUMNS,
  type PrincipalRow,
} from "../../permissions";
import { deliverEmail, type EmailItem } from "../email";
import { deliverPush, type PushItem } from "../push/delivery";
import { readSiteSettings } from "../settings";
import { notificationChannels, typeById } from "./types";

/** An alert written straight to a member, outside the event fan-out. */
export type DirectNotice = {
  userId: number;
  contentType: string;
  contentId: number;
  data: Record<string, unknown>;
};

type Recipient = PrincipalRow & {
  id: number;
  group_id: number;
  banned_permanently: number;
  banned_until: number | null;
  notification_epoch: number;
};

/**
 * Writes one alert of `type` to each member in `notices` (one per member, at most a few hundred),
 * as the event fan-out would: the member's in-app preference decides whether it is written at all,
 * the unread counter follows, and e-mail and push are handed on where the member (or the type's
 * default) has them on. Banned members and members who may not view alerts get none. One batch is
 * three statements however many members it holds, and publishes one `notification.created`
 * event. Call it in the caller's write transaction. Returns the ids of the members alerted.
 */
export function deliverDirect(
  ctx: Ctx,
  type: string,
  actorId: number | null,
  notices: readonly DirectNotice[],
): Set<number> {
  const alerted = new Set<number>();
  if (!notices.length) return alerted;
  const definition = typeById.get(type)!;
  const encoded = JSON.stringify(notices.map((notice) => notice.userId));
  const recipients = new Map(
    prepared(ctx, "notifications.direct.recipients", () =>
      ctx.sqlite.prepare<Recipient, [string]>(
        `SELECT u.id, u.group_id, u.notification_epoch, ${PRINCIPAL_COLUMNS} FROM users u WHERE u.id IN (SELECT value FROM json_each(?1))`,
      ),
    )
      .all(encoded)
      .map((row) => [row.id, row]),
  );
  const prefs = new Map(
    prepared(ctx, "notifications.direct.preferences", () =>
      ctx.sqlite.prepare<
        { user_id: number; in_app: number | null; email: number | null; push: number | null },
        [string, string]
      >(
        "SELECT user_id, in_app, email, push FROM notification_preferences WHERE user_id IN (SELECT value FROM json_each(?1)) AND type = ?2",
      ),
    )
      .all(encoded, type)
      .map((row) => [row.user_id, row]),
  );
  const adminDefaults = readSiteSettings(ctx).notificationDefaults[type];
  const defaultInApp = adminDefaults?.inApp ?? definition.defaults.inApp;
  const defaultEmail = adminDefaults?.email ?? definition.defaults.email;
  const defaultPush = adminDefaults?.push ?? definition.defaults.push;
  const now = ctx.now();
  const versions = currentVersions(ctx);
  const rows: Array<Record<string, unknown>> = [];
  const wanted: DirectNotice[] = [];
  for (const notice of notices) {
    const row = recipients.get(notice.userId);
    if (!row || alerted.has(row.id)) continue;
    if (row.banned_permanently || (row.banned_until !== null && row.banned_until > now)) continue;
    if (!(prefs.get(row.id)?.in_app ?? defaultInApp)) continue;
    if (!can(ctx, memberActor(row.id, row.group_id, row, versions), "notification.view")) continue;
    alerted.add(row.id);
    wanted.push(notice);
    rows.push({
      userId: row.id,
      epoch: row.notification_epoch,
      contentType: notice.contentType,
      contentId: notice.contentId,
      data: JSON.stringify(notice.data),
    });
  }
  if (!rows.length) return alerted;
  const created = prepared(ctx, "notifications.direct.insert", () =>
    ctx.sqlite.prepare<{ id: number; user_id: number }, [string, string, number | null, number]>(
      "INSERT INTO notifications (user_id, epoch, type, content_type, content_id, actor_id, actor_count, actor_ids, data, created_at, updated_at) SELECT json_extract(value, '$.userId'), json_extract(value, '$.epoch'), ?2, json_extract(value, '$.contentType'), json_extract(value, '$.contentId'), ?3, 1, CASE WHEN ?3 IS NULL THEN '[]' ELSE json_array(?3) END, json_extract(value, '$.data'), ?4, ?4 FROM json_each(?1) RETURNING id, user_id",
    ),
  ).all(JSON.stringify(rows), type, actorId, now);
  prepared(ctx, "notifications.direct.countUp", () =>
    ctx.sqlite.prepare<unknown, [string]>(
      "UPDATE users SET unread_notification_count = unread_notification_count + 1 WHERE id IN (SELECT value FROM json_each(?1))",
    ),
  ).run(JSON.stringify(created.map((row) => row.user_id)));
  publishEvent(ctx, {
    type: "notification.created",
    targetType: "notification",
    targetId: created[0]!.id,
    payload: {
      notificationIds: created.map((row) => row.id),
      userIds: created.map((row) => row.user_id),
    },
  });
  const byUser = new Map(wanted.map((notice) => [notice.userId, notice]));
  const emailItems: EmailItem[] = [];
  const pushItems: PushItem[] = [];
  for (const row of created) {
    const notice = byUser.get(row.user_id)!;
    const pref = prefs.get(row.user_id);
    const item = {
      notificationId: row.id,
      userId: row.user_id,
      type,
      contentType: notice.contentType,
      contentId: notice.contentId,
      threadId: null,
      actorId,
      data: notice.data,
    };
    if (pref?.email ?? defaultEmail) emailItems.push(item);
    if (pref?.push ?? defaultPush) pushItems.push(item);
  }
  if (emailItems.length) deliverEmail(ctx, emailItems, notificationChannels);
  if (pushItems.length) deliverPush(ctx, pushItems, notificationChannels.defaults);
  return alerted;
}
